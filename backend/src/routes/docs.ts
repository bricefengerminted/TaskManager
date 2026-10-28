import { Router, Request, Response } from 'express';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import { projects, tasks, roadmapItems } from '../db/schema';
import { DOC_STATUSES, DOC_KEYS, isValidIsoDate, docRow, evaluateDocs, type DocKey, type DocStatus } from '../../../shared/doc-matrix';
import { buildContext, buildEvidence, projectHealth, todayIso } from '../lib/doc-check';
import { actorOf, logActivity } from '../lib/activity';
import { asyncHandler } from '../lib/async-handler';

const router = Router();

// GET /api/docs/health?half=&team=&status=&project_id=&today=
router.get('/health', asyncHandler(async (req: Request, res: Response) => {
  const q = (k: string) => (typeof req.query[k] === 'string' && req.query[k] !== '' ? String(req.query[k]) : undefined);
  const today = q('today') ?? todayIso();
  if (!isValidIsoDate(today)) return res.status(400).json({ error: 'today must be a real YYYY-MM-DD date' });
  if (q('status') && !DOC_STATUSES.includes(q('status') as DocStatus)) {
    return res.status(400).json({ error: `status must be one of ${DOC_STATUSES.join(', ')}` });
  }

  const tracked = await db.select().from(projects)
    .where(and(eq(projects.status, 'active'), inArray(projects.docs_stage, ['proposal', 'roadmap'])))
    .all();
  const items = new Map((await db.select().from(roadmapItems).all()).map((i) => [i.id, i]));
  const docTasks = await db.select().from(tasks).where(isNotNull(tasks.doc_key)).all();

  let result = tracked.map((p) =>
    projectHealth(p, p.roadmap_item_id ? items.get(p.roadmap_item_id) : undefined, docTasks.filter((t) => t.project_id === p.id), today)
  );

  const projectId = q('project_id');
  const team = q('team');
  const half = q('half');
  const status = q('status');
  if (projectId) result = result.filter((p) => p.project_id === projectId);
  if (team) result = result.filter((p) => p.team === team);
  if (half) result = result.filter((p) => p.half === half);
  if (status) result = result.filter((p) => p.rows.some((r) => r.status === status));

  const overdue = (p: (typeof result)[number]) => p.rows.filter((r) => r.status === 'overdue').length;
  result.sort((a, b) => overdue(b) - overdue(a) || a.name.localeCompare(b.name));

  const summary = Object.fromEntries(DOC_STATUSES.map((s) => [s, 0])) as Record<DocStatus, number>;
  for (const p of result) for (const r of p.rows) summary[r.status] += 1;

  res.json({ today, summary, projects: result });
}));

interface PageEvidenceInput {
  page_url?: string | null;
  published?: boolean;
  results_filled?: boolean;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Returns an error message, or null when the evidence map is well formed. */
function validateEvidence(ev: unknown): string | null {
  if (ev === undefined) return null;
  if (!isPlainObject(ev)) return 'evidence must be an object';
  for (const [key, val] of Object.entries(ev)) {
    if (!DOC_KEYS.includes(key as DocKey)) return `evidence has unknown doc key: ${key}`;
    if (val === null) continue;
    if (!isPlainObject(val)) return `evidence.${key} must be an object or null`;
    if (val.page_url !== undefined && val.page_url !== null && typeof val.page_url !== 'string') return `evidence.${key}.page_url must be a string or null`;
    for (const f of ['published', 'results_filled']) {
      if (val[f] !== undefined && typeof val[f] !== 'boolean') return `evidence.${key}.${f} must be a boolean`;
    }
  }
  return null;
}

// POST /api/docs/apply { project_id, evidence?, today? }
router.post('/apply', asyncHandler(async (req: Request, res: Response) => {
  const body = isPlainObject(req.body) ? req.body : {};
  const { project_id, evidence, today: todayParam } = body as Record<string, unknown>;
  if (typeof project_id !== 'string' || !project_id) return res.status(400).json({ error: 'project_id is required' });
  const evErr = validateEvidence(evidence);
  if (evErr) return res.status(400).json({ error: evErr });
  const today = todayParam === undefined ? todayIso() : todayParam;
  if (!isValidIsoDate(today)) return res.status(400).json({ error: 'today must be a real YYYY-MM-DD date' });
  const evidenceIn = (evidence ?? {}) as Partial<Record<DocKey, PageEvidenceInput>>;
  const actor = actorOf(req);

  const p = await db.select().from(projects).where(eq(projects.id, project_id)).get();
  if (!p) return res.status(404).json({ error: 'Project not found' });
  if (p.docs_stage !== 'proposal' && p.docs_stage !== 'roadmap') {
    return res.status(400).json({ error: 'Project is not tracked by the doc system' });
  }
  const item = p.roadmap_item_id
    ? await db.select().from(roadmapItems).where(eq(roadmapItems.id, p.roadmap_item_id)).get()
    : undefined;

  const out = await db.transaction(async (tx) => {
    const loadDocTasks = () =>
      tx.select().from(tasks).where(and(eq(tasks.project_id, p.id), isNotNull(tasks.doc_key))).all();

    const created: { id: string; doc_key: DocKey; due_date: string | null }[] = [];
    const redated: { id: string; doc_key: DocKey; from: string | null; to: string | null }[] = [];
    const completed: { id: string; doc_key: DocKey }[] = [];
    const ts = new Date().toISOString();

    // Pass 1: upsert one task per required row, store evidence, re-date.
    const required = evaluateDocs(buildContext(p, item), {}, today);
    let docTasks = await loadDocTasks();
    const maxPos = await tx.select({ max: sql<number>`coalesce(max(${tasks.position}), -1)` })
      .from(tasks).where(and(eq(tasks.project_id, p.id), eq(tasks.status, 'todo'))).get();
    let position = Number(maxPos?.max ?? -1) + 1;

    for (const r of required) {
      let task = docTasks.find((t) => t.doc_key === r.key);
      const ev = evidenceIn[r.key];
      if (!task) {
        if (r.status === 'waived' && !ev) continue;
        const id = uuidv4();
        const title = `Doc: ${r.label}`;
        // drizzle 0.30 can't express a partial-index conflict target, so use a bare
        // ON CONFLICT DO NOTHING (covers idx_tasks_project_doc_key) and re-read on a miss.
        const inserted = await tx.insert(tasks).values({
          id, project_id: p.id, title,
          description: `Required by the doc matrix (${r.due_rule}).`,
          status: 'todo', priority: 'medium', due_date: r.due, position: position++,
          images: '[]', links: '[]', doc_type: r.key.split('.')[0],
          doc_key: r.key, doc_status: null, due_rule: r.due_rule,
          doc_evidence: ev ? JSON.stringify(ev) : null,
          source: 'manual', slack_raw: null, created_at: ts, updated_at: ts,
        }).onConflictDoNothing().returning({ id: tasks.id }).all();
        if (inserted.length) {
          created.push({ id, doc_key: r.key, due_date: r.due });
          await logActivity({ actor, type: 'doc_task_created', project_id: p.id, task_id: id, task_title: title,
            summary: `Created "${title}" due ${r.due ?? 'undated'}`, detail: { doc_key: r.key, due_rule: r.due_rule } }, tx);
          continue;
        }
        // Lost a race: another writer created it. Re-read and fall through to update.
        task = (await loadDocTasks()).find((t) => t.doc_key === r.key);
        if (!task) continue;
      }
      const set: Partial<typeof task> = { due_rule: r.due_rule };
      if (ev) set.doc_evidence = JSON.stringify(ev);
      if (task.due_date !== r.due) {
        set.due_date = r.due;
        redated.push({ id: task.id, doc_key: r.key, from: task.due_date, to: r.due });
        await logActivity({ actor, type: 'doc_due_changed', project_id: p.id, task_id: task.id, task_title: task.title,
          summary: `Due date ${task.due_date ?? 'none'} → ${r.due ?? 'none'} (${r.due_rule})`,
          detail: { doc_key: r.key, from: task.due_date, to: r.due } }, tx);
      }
      await tx.update(tasks).set({ ...set, updated_at: ts }).where(eq(tasks.id, task.id)).run();
    }

    // Pass 2: compute statuses with evidence; persist; complete link-only rows.
    docTasks = await loadDocTasks();
    const rows = evaluateDocs(buildContext(p, item), buildEvidence(p, item, docTasks), today);
    for (const t of docTasks) {
      const r = rows.find((x) => x.key === t.doc_key);
      const status: DocStatus = r ? r.status : 'waived';
      const set: Partial<typeof t> = { doc_status: status };
      if (r && docRow(r.key).linkOnly && r.status === 'done' && t.status !== 'done') {
        set.status = 'done';
        completed.push({ id: t.id, doc_key: r.key });
        await logActivity({ actor, type: 'doc_task_completed', project_id: p.id, task_id: t.id, task_title: t.title,
          summary: `Completed "${t.title}" (link set)`, detail: { doc_key: r.key, link: r.link } }, tx);
      }
      await tx.update(tasks).set(set).where(eq(tasks.id, t.id)).run();
    }

    return { rows, created, redated, completed };
  });

  return res.json(out);
}));

export default router;

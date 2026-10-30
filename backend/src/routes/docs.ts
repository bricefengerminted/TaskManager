import { Router, Request, Response } from 'express';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import { projects, tasks, roadmapItems } from '../db/schema';
import { DOC_STATUSES, DOC_KEYS, isValidIsoDate, docRow, evaluateDocs, type DocKey, type DocStatus } from '../../../shared/doc-matrix';
import { buildContext, buildEvidence, parseJson, projectHealth, todayIso } from '../lib/doc-check';
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
  const { project_id, evidence, today: todayParam, dry_run } = body as Record<string, unknown>;
  if (dry_run !== undefined && typeof dry_run !== 'boolean') return res.status(400).json({ error: 'dry_run must be a boolean' });
  if (typeof project_id !== 'string' || !project_id) return res.status(400).json({ error: 'project_id is required' });
  const evErr = validateEvidence(evidence);
  if (evErr) return res.status(400).json({ error: evErr });
  const today = todayParam === undefined ? todayIso() : todayParam;
  if (!isValidIsoDate(today)) return res.status(400).json({ error: 'today must be a real YYYY-MM-DD date' });
  const evidenceIn = (evidence ?? {}) as Partial<Record<DocKey, PageEvidenceInput | null>>;
  const dryRun = dry_run === true;
  const actor = actorOf(req);

  const p = await db.select().from(projects).where(eq(projects.id, project_id)).get();
  if (!p) return res.status(404).json({ error: 'Project not found' });
  if (p.docs_stage !== 'proposal' && p.docs_stage !== 'roadmap') {
    return res.status(400).json({ error: 'Project is not tracked by the doc system' });
  }
  const item = p.roadmap_item_id
    ? await db.select().from(roadmapItems).where(eq(roadmapItems.id, p.roadmap_item_id)).get()
    : undefined;

  type Out = {
    rows: ReturnType<typeof evaluateDocs>;
    created: { id: string; doc_key: DocKey; due_date: string | null }[];
    redated: { id: string; doc_key: DocKey; from: string | null; to: string | null }[];
    completed: { id: string; doc_key: DocKey }[];
    conflicts: { id: string; doc_key: DocKey; task_due: string | null; matrix_due: string | null; due_rule: string }[];
    ignored_evidence: string[];
  };
  class Rollback extends Error {
    constructor(public out: Out) { super('dry run rollback'); }
  }

  const run = () => db.transaction(async (tx): Promise<Out> => {
    const loadDocTasks = () =>
      tx.select().from(tasks).where(and(eq(tasks.project_id, p.id), isNotNull(tasks.doc_key))).all();

    const created: Out['created'] = [];
    const redated: Out['redated'] = [];
    const completed: Out['completed'] = [];
    const conflicts: Out['conflicts'] = [];
    const ts = new Date().toISOString();

    // Pass 1: upsert one task per required row, store evidence, re-date.
    // Link evidence is included so link-only rows that are already linked are created as done.
    const required = evaluateDocs(buildContext(p, item), buildEvidence(p, item, []), today);
    const requiredKeys = new Set<string>(required.map((r) => r.key));
    const ignored_evidence = Object.keys(evidenceIn).filter((k) => !requiredKeys.has(k));
    let docTasks = await loadDocTasks();
    const maxPos = await tx.select({ max: sql<number>`coalesce(max(${tasks.position}), -1)` })
      .from(tasks).where(and(eq(tasks.project_id, p.id), eq(tasks.status, 'todo'))).get();
    let position = Number(maxPos?.max ?? -1) + 1;

    for (const r of required) {
      let task = docTasks.find((t) => t.doc_key === r.key);
      const ev = evidenceIn[r.key]; // undefined = leave stored evidence alone
      if (!task) {
        if (r.status === 'waived' && !ev) continue;
        const id = uuidv4();
        const title = `Doc: ${r.label}`;
        const alreadyDone = docRow(r.key).linkOnly === true && r.status === 'done';
        // drizzle 0.30 can't express a partial-index conflict target, so use a bare
        // ON CONFLICT DO NOTHING (covers idx_tasks_project_doc_key) and re-read on a miss.
        const inserted = await tx.insert(tasks).values({
          id, project_id: p.id, title,
          description: `Required by the doc matrix (${r.due_rule}).`,
          status: alreadyDone ? 'done' : 'todo', priority: 'medium', due_date: r.due, position: position++,
          images: '[]', links: '[]', doc_type: r.key.split('.')[0],
          doc_key: r.key, doc_status: null, due_rule: r.due_rule, due_computed: r.due,
          doc_evidence: ev ? JSON.stringify(ev) : null,
          source: 'manual', slack_raw: null, created_at: ts, updated_at: ts,
        }).onConflictDoNothing().returning({ id: tasks.id }).all();
        if (inserted.length) {
          created.push({ id, doc_key: r.key, due_date: r.due });
          if (alreadyDone) completed.push({ id, doc_key: r.key });
          await logActivity({ actor, type: 'doc_task_created', project_id: p.id, task_id: id, task_title: title,
            summary: `Created "${title}" due ${r.due ?? 'undated'}${alreadyDone ? ' (already done: link set)' : ''}`,
            detail: { doc_key: r.key, due_rule: r.due_rule, done: alreadyDone } }, tx);
          continue;
        }
        // Lost a race: another writer created it. Re-read and fall through to update.
        task = (await loadDocTasks()).find((t) => t.doc_key === r.key);
        if (!task) throw new Error(`Unexpected insert conflict for ${r.key}; rolling back`);
      }

      const set: Partial<typeof task> = {};
      if (task.due_rule !== r.due_rule) set.due_rule = r.due_rule;
      // Evidence: an object REPLACES the stored evidence wholesale; null clears it.
      if (ev !== undefined) {
        const next = ev === null ? null : JSON.stringify(ev);
        if (next !== task.doc_evidence) set.doc_evidence = next;
      }
      // Due dates: only move a date the matrix itself set (or a missing one). A manual edit is
      // never overwritten and a null matrix date never blanks an existing date.
      // A null matrix date (anchor temporarily missing) must not erase the last computed one.
      if (r.due !== null && task.due_computed !== r.due) set.due_computed = r.due;
      if (r.status !== 'waived' && r.due !== null && task.due_date !== r.due && !task.due_pinned) {
        if (task.due_date === null || task.due_date === task.due_computed) {
          set.due_date = r.due;
          redated.push({ id: task.id, doc_key: r.key, from: task.due_date, to: r.due });
          await logActivity({ actor, type: 'doc_due_changed', project_id: p.id, task_id: task.id, task_title: task.title,
            summary: `Due date ${task.due_date ?? 'none'} → ${r.due} (${r.due_rule})`,
            detail: { doc_key: r.key, from: task.due_date, to: r.due } }, tx);
        } else if (task.status !== 'done') {
          conflicts.push({ id: task.id, doc_key: r.key, task_due: task.due_date, matrix_due: r.due, due_rule: r.due_rule });
          if (task.due_computed !== r.due) {
            await logActivity({ actor, type: 'doc_due_conflict', project_id: p.id, task_id: task.id, task_title: task.title,
              summary: `Kept due ${task.due_date}; matrix says ${r.due} (${r.due_rule})`,
              detail: { doc_key: r.key, task_due: task.due_date, matrix_due: r.due } }, tx);
          }
        }
      }
      if (Object.keys(set).length) {
        await tx.update(tasks).set({ ...set, updated_at: ts }).where(eq(tasks.id, task.id)).run();
      }
    }

    // Pass 2: compute statuses with evidence; persist; complete link-only rows.
    docTasks = await loadDocTasks();
    const rows = evaluateDocs(buildContext(p, item), buildEvidence(p, item, docTasks), today);
    for (const t of docTasks) {
      const r = rows.find((x) => x.key === t.doc_key);
      const status: DocStatus | null = r ? r.status : null;
      const set: Partial<typeof t> = {};
      if (t.doc_status !== status) set.doc_status = status;
      if (r && docRow(r.key).linkOnly && r.status === 'done' && t.status !== 'done') {
        set.status = 'done';
        completed.push({ id: t.id, doc_key: r.key });
        await logActivity({ actor, type: 'doc_task_completed', project_id: p.id, task_id: t.id, task_title: t.title,
          summary: `Completed "${t.title}" (link set)`, detail: { doc_key: r.key, link: r.link } }, tx);
      }
      if (Object.keys(set).length) {
        await tx.update(tasks).set({ ...set, updated_at: ts }).where(eq(tasks.id, t.id)).run();
      }
    }

    const out: Out = { rows, created, redated, completed, conflicts, ignored_evidence };
    if (dryRun) throw new Rollback(out); // roll back every write, activity included
    await logActivity({ actor, type: 'docs_applied', project_id: p.id,
      summary: `Docs applied: ${created.length} created, ${redated.length} re-dated, ${completed.length} completed, ${conflicts.length} conflicts`,
      detail: {
        created: created.length, redated: redated.length, completed: completed.length, conflicts: conflicts.length,
        evidence_keys: Object.keys(evidenceIn), ignored_evidence,
      } }, tx);
    return out;
  });

  let out: Out;
  try {
    out = await run();
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
    out = e.out;
  }
  return res.json({ ...out, dry_run: dryRun });
}));

// POST /api/docs/resolve-conflict { task_id, action: 'accept' | 'keep' }
router.post('/resolve-conflict', asyncHandler(async (req: Request, res: Response) => {
  const { task_id, action } = isPlainObject(req.body) ? req.body : ({} as Record<string, unknown>);
  if (typeof task_id !== 'string' || !task_id) return res.status(400).json({ error: 'task_id is required' });
  if (action !== 'accept' && action !== 'keep') return res.status(400).json({ error: "action must be 'accept' or 'keep'" });
  const t = await db.select().from(tasks).where(eq(tasks.id, task_id)).get();
  if (!t || !t.doc_key) return res.status(400).json({ error: 'Not a doc task' });
  if (action === 'accept' && !t.due_computed) return res.status(400).json({ error: 'No computed due date yet; run apply first' });

  const to = action === 'accept' ? t.due_computed : t.due_date;
  await db.transaction(async (tx) => {
    await tx.update(tasks)
      .set(action === 'accept'
        ? { due_date: t.due_computed, due_pinned: 0, updated_at: new Date().toISOString() }
        : { due_pinned: 1, updated_at: new Date().toISOString() })
      .where(eq(tasks.id, t.id)).run();
    await logActivity({ actor: actorOf(req), type: 'doc_due_conflict_resolved', project_id: t.project_id, task_id: t.id, task_title: t.title,
      summary: action === 'accept' ? `Accepted matrix due ${to} (was ${t.due_date ?? 'none'})` : `Kept manual due ${t.due_date ?? 'none'}`,
      detail: { doc_key: t.doc_key, action, from: t.due_date, to } }, tx);
  });
  return res.json({ id: t.id, doc_key: t.doc_key, action, due_date: to, pinned: action === 'keep' });
}));

const isDraftUrl = (u: string) => /draftId=|resumedraft\.action/.test(u);

// POST /api/docs/row { project_id, doc_key, link?, done?, due_date?, today? }
// Edits one row from the Docs panel. link: an https URL, or null to clear it (hub → project hub_url,
// other docs → the doc task's page evidence). done: ticks or reopens the doc task; ticking needs a link
// and drops the project's "not required" waiver for the doc, since a waiver outranks done.
// due_date: a YYYY-MM-DD date pins the task to it; null unpins it back to the matrix date.
router.post('/row', asyncHandler(async (req: Request, res: Response) => {
  const body = (isPlainObject(req.body) ? req.body : {}) as Record<string, unknown>;
  const { project_id, doc_key, link, done, due_date } = body;
  if (typeof project_id !== 'string' || !project_id) return res.status(400).json({ error: 'project_id is required' });
  if (!DOC_KEYS.includes(doc_key as DocKey)) return res.status(400).json({ error: 'doc_key must be a doc key' });
  const key = doc_key as DocKey;
  if (link !== undefined && link !== null && (typeof link !== 'string' || !/^https:\/\/\S+$/.test(link.trim()))) {
    return res.status(400).json({ error: 'link must be an https URL or null' });
  }
  if (done !== undefined && typeof done !== 'boolean') return res.status(400).json({ error: 'done must be a boolean' });
  if (due_date !== undefined && due_date !== null && !isValidIsoDate(due_date)) {
    return res.status(400).json({ error: 'due_date must be a real YYYY-MM-DD date or null' });
  }
  const today = body.today === undefined ? todayIso() : body.today;
  if (!isValidIsoDate(today)) return res.status(400).json({ error: 'today must be a real YYYY-MM-DD date' });

  const p = await db.select().from(projects).where(eq(projects.id, project_id)).get();
  if (!p) return res.status(404).json({ error: 'Project not found' });
  if (p.docs_stage !== 'proposal' && p.docs_stage !== 'roadmap') {
    return res.status(400).json({ error: 'Project is not tracked by the doc system' });
  }
  const item = p.roadmap_item_id
    ? await db.select().from(roadmapItems).where(eq(roadmapItems.id, p.roadmap_item_id)).get()
    : undefined;
  const loadDocTasks = () =>
    db.select().from(tasks).where(and(eq(tasks.project_id, p.id), isNotNull(tasks.doc_key))).all();
  const row = evaluateDocs(buildContext(p, item), buildEvidence(p, item, await loadDocTasks()), today).find((r) => r.key === key);
  if (!row) return res.status(400).json({ error: `${key} is not required for this project` });
  const matrix = docRow(key);
  const newLink = typeof link === 'string' ? link.trim() : link;
  if (done === true && !matrix.taskOnly && !(newLink ?? row.link)) return res.status(400).json({ error: 'Add a link before marking it done' });
  const waivers = parseJson<Record<string, string>>(p.waivers, {});
  if (done === true && row.status === 'waived' && !waivers[key]) {
    return res.status(400).json({ error: "Not required for this project's stage or doc mode, so it can't be marked done" });
  }

  const actor = actorOf(req);
  const ts = new Date().toISOString();
  const changes: string[] = [];
  await db.transaction(async (tx) => {
    let task = (await tx.select().from(tasks).where(and(eq(tasks.project_id, p.id), eq(tasks.doc_key, key))).all())[0];
    if (!task) {
      const id = uuidv4();
      await tx.insert(tasks).values({
        id, project_id: p.id, title: `Doc: ${row.label}`,
        description: `Required by the doc matrix (${row.due_rule}).`,
        status: 'todo', priority: 'medium', due_date: row.due, position: 0,
        images: '[]', links: '[]', doc_type: key.split('.')[0],
        doc_key: key, doc_status: null, due_rule: row.due_rule, due_computed: row.due, doc_evidence: null,
        source: 'manual', slack_raw: null, created_at: ts, updated_at: ts,
      }).onConflictDoNothing().run();
      task = (await tx.select().from(tasks).where(and(eq(tasks.project_id, p.id), eq(tasks.doc_key, key))).all())[0];
    }
    const set: Partial<typeof task> = {};
    if (newLink !== undefined) {
      if (key === 'hub') {
        await tx.update(projects).set({ hub_url: newLink, updated_at: ts }).where(eq(projects.id, p.id)).run();
      } else {
        const prev = task.doc_evidence ? JSON.parse(task.doc_evidence) as PageEvidenceInput : {};
        set.doc_evidence = newLink === null
          ? null
          : JSON.stringify({ ...prev, page_url: newLink, published: !isDraftUrl(newLink) });
      }
      changes.push(newLink === null ? 'link cleared' : `link set to ${newLink}`);
    }
    if (done !== undefined) {
      set.status = done ? 'done' : 'todo';
      // Marking a results doc done says its Results section is filled in.
      if (done && matrix.needsResults) {
        const ev = set.doc_evidence !== undefined ? set.doc_evidence : task.doc_evidence;
        set.doc_evidence = JSON.stringify({ ...(ev ? JSON.parse(ev) : {}), results_filled: true });
      }
      changes.push(done ? 'marked done' : 'reopened');
      if (done && waivers[key]) {
        const { [key]: _dropped, ...rest } = waivers;
        await tx.update(projects).set({ waivers: JSON.stringify(rest), updated_at: ts }).where(eq(projects.id, p.id)).run();
        changes.push('now required');
      }
    }
    if (due_date !== undefined) {
      if (due_date === null) {
        set.due_date = task.due_computed;
        set.due_pinned = 0;
        changes.push(`due back to ${task.due_computed ?? 'the rule'}`);
      } else {
        set.due_date = due_date as string;
        set.due_pinned = 1;
        changes.push(`due pinned to ${due_date}`);
      }
    }
    if (Object.keys(set).length) await tx.update(tasks).set({ ...set, updated_at: ts }).where(eq(tasks.id, task.id)).run();
    await logActivity({ actor, type: 'doc_row_updated', project_id: p.id, task_id: task.id, task_title: task.title,
      summary: `${row.label}: ${changes.join(', ') || 'no changes'}`,
      detail: { doc_key: key, link: newLink, done, due_date } }, tx);
  });

  const fresh = await db.select().from(projects).where(eq(projects.id, p.id)).get();
  return res.json(projectHealth(fresh!, item, await loadDocTasks(), today));
}));

export default router;

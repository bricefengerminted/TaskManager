import { Router, Request, Response } from 'express';
import { eq, and, ne, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import { projects, tasks, roadmapItems } from '../db/schema';
import type { CreateProjectInput, UpdateProjectInput, ProjectDocsInput } from '../../../shared/types';
import { DOC_KEYS, isValidIsoDate, type DocKey } from '../../../shared/doc-matrix';
import { serializeProject, TEAM_ABBREV, todayIso } from '../lib/doc-check';
import { asyncHandler } from '../lib/async-handler';
import { actorOf, logActivity } from '../lib/activity';

const router = Router();

async function itemsById() {
  return new Map((await db.select().from(roadmapItems).all()).map((i) => [i.id, i]));
}

function now() {
  return new Date().toISOString();
}

// GET /api/projects
router.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(projects).where(eq(projects.status, 'active')).all();
    const items = new Map((await db.select().from(roadmapItems).all()).map((i) => [i.id, i]));

    const result = await Promise.all(rows.map(async (p) => {
      const counts = await db
        .select({
          status: tasks.status,
          count: sql<number>`count(*)`.as('count'),
        })
        .from(tasks)
        .where(eq(tasks.project_id, p.id))
        .groupBy(tasks.status)
        .all();

      const taskCounts = { todo: 0, in_progress: 0, done: 0, overdue: 0 };
      for (const c of counts) {
        if (c.status === 'todo') taskCounts.todo = Number(c.count);
        if (c.status === 'in_progress') taskCounts.in_progress = Number(c.count);
        if (c.status === 'done') taskCounts.done = Number(c.count);
      }

      const today = new Date().toISOString().split('T')[0];
      const overdueCount = await db
        .select({ count: sql<number>`count(*)`.as('count') })
        .from(tasks)
        .where(
          sql`${tasks.project_id} = ${p.id} AND ${tasks.due_date} IS NOT NULL AND ${tasks.due_date} < ${today} AND ${tasks.status} != 'done'`
        )
        .get();
      taskCounts.overdue = Number(overdueCount?.count ?? 0);

      const item = p.roadmap_item_id ? items.get(p.roadmap_item_id) : undefined;
      return { ...serializeProject(p, item), task_counts: taskCounts };
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// GET /api/projects/archived
router.get('/archived', asyncHandler(async (_req: Request, res: Response) => {
  const rows = await db.select().from(projects).where(eq(projects.status, 'archived')).all();
  const items = await itemsById();
  res.json(rows.map((p) => serializeProject(p, p.roadmap_item_id ? items.get(p.roadmap_item_id) : undefined)));
}));

// POST /api/projects
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { name, description = '' }: CreateProjectInput = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const id = uuidv4();
  const ts = now();
  await db.insert(projects).values({ id, name: name.trim(), description, status: 'active', created_at: ts, updated_at: ts }).run();
  const project = await db.select().from(projects).where(eq(projects.id, id)).get();
  return res.status(201).json(serializeProject(project!));
}));

// GET /api/projects/:id
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const project = await db.select().from(projects).where(eq(projects.id, req.params.id)).get();
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const item = project.roadmap_item_id
    ? await db.select().from(roadmapItems).where(eq(roadmapItems.id, project.roadmap_item_id)).get()
    : undefined;
  return res.json(serializeProject(project, item));
}));

// PUT /api/projects/:id
router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const { name, description, status }: UpdateProjectInput = req.body ?? {};
  const project = await db.select().from(projects).where(eq(projects.id, req.params.id)).get();
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const updated = {
    ...project,
    name: name?.trim() ?? project.name,
    description: description ?? project.description,
    status: status ?? project.status,
    updated_at: now(),
  };
  await db.update(projects).set(updated).where(eq(projects.id, req.params.id)).run();
  const item = updated.roadmap_item_id
    ? await db.select().from(roadmapItems).where(eq(roadmapItems.id, updated.roadmap_item_id)).get()
    : undefined;
  return res.json(serializeProject(updated, item));
}));

const DOCS_STAGES = ['proposal', 'roadmap', 'not_pursued'];
const DECISIONS = ['go', 'no_go', 'parked'];
const DOC_MODES = ['full', 'one_pager_only'];
const TEAMS = Object.values(TEAM_ABBREV);
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isHttps = (v: unknown) => v === null || (typeof v === 'string' && v.startsWith('https://'));

// PATCH /api/projects/:id/docs
router.patch('/:id/docs', asyncHandler(async (req: Request, res: Response) => {
  const project = await db.select().from(projects).where(eq(projects.id, req.params.id)).get();
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const body: ProjectDocsInput = isPlainObject(req.body) ? req.body : {};
  const bad = (error: string) => res.status(400).json({ error });
  const changes: Partial<typeof project> = {};

  // Type checks up front.
  if (body.waivers !== undefined && !isPlainObject(body.waivers)) return bad('waivers must be an object');
  if (body.decision_reason !== undefined && body.decision_reason !== null && typeof body.decision_reason !== 'string') return bad('decision_reason must be a string');
  if (body.customer_facing !== undefined && typeof body.customer_facing !== 'boolean') return bad('customer_facing must be a boolean');
  if (body.team !== undefined && body.team !== null && !TEAMS.includes(body.team)) return bad(`team must be null or one of ${TEAMS.join(', ')}`);
  if (body.hub_url !== undefined && !isHttps(body.hub_url)) return bad('hub_url must be null or an https:// URL');
  if (body.one_pager_url !== undefined && !isHttps(body.one_pager_url)) return bad('one_pager_url must be null or an https:// URL');
  if (body.docs_stage !== undefined && body.docs_stage !== null && !DOCS_STAGES.includes(body.docs_stage)) return bad('Invalid docs_stage');
  if (body.doc_mode !== undefined && !DOC_MODES.includes(body.doc_mode)) return bad('Invalid doc_mode');

  let linkedAfter = project.roadmap_item_id;
  if (body.roadmap_item_id !== undefined) {
    if (body.roadmap_item_id === null) {
      linkedAfter = null;
      changes.roadmap_item_id = null;
      if (body.docs_stage === 'roadmap') return bad('docs_stage "roadmap" needs a linked roadmap item');
      changes.docs_stage = body.docs_stage ?? 'proposal';
    } else {
      if (typeof body.roadmap_item_id !== 'string') return bad('roadmap_item_id must be a string or null');
      if (body.docs_stage != null && body.docs_stage !== 'roadmap') return bad('Linking a roadmap item requires docs_stage "roadmap"');
      const item = await db.select().from(roadmapItems).where(eq(roadmapItems.id, body.roadmap_item_id)).get();
      if (!item) return bad('Unknown roadmap item');
      const other = await db.select().from(projects)
        .where(and(eq(projects.roadmap_item_id, body.roadmap_item_id), ne(projects.id, project.id))).get();
      if (other) return res.status(409).json({ error: `Roadmap item already linked to "${other.name}"` });
      linkedAfter = item.id;
      changes.roadmap_item_id = item.id;
      changes.docs_stage = 'roadmap';
      if (!project.team && item.team_name && TEAM_ABBREV[item.team_name]) changes.team = TEAM_ABBREV[item.team_name];
    }
  }

  if (body.docs_stage !== undefined && body.roadmap_item_id === undefined) {
    if (body.docs_stage === 'roadmap' && !linkedAfter) return bad('docs_stage "roadmap" needs a linked roadmap item');
    changes.docs_stage = body.docs_stage;
  }
  if (body.team !== undefined) changes.team = body.team;

  if (body.decision !== undefined) {
    if (body.decision === null) {
      changes.decision = null;
      changes.decision_date = null;
      changes.decision_reason = null;
      changes.revisit_by = null;
    } else {
      if (!DECISIONS.includes(body.decision)) return bad('Invalid decision');
      if (typeof body.decision_reason !== 'string' || !body.decision_reason.trim()) return bad('decision_reason is required');
      if (body.decision === 'parked' && !isValidIsoDate(body.revisit_by)) return bad('revisit_by (a real YYYY-MM-DD date) is required when parked');
      if (body.decision === 'no_go' && body.docs_stage != null && body.docs_stage !== 'not_pursued') {
        return bad('decision no_go requires docs_stage "not_pursued"');
      }
      const revisit = body.decision === 'parked' ? body.revisit_by! : null;
      const reason = body.decision_reason.trim();
      const same = project.decision === body.decision && project.decision_reason === reason && project.revisit_by === revisit;
      changes.decision = body.decision;
      changes.decision_reason = reason;
      changes.revisit_by = revisit;
      if (!same || !project.decision_date) changes.decision_date = todayIso();
      if (body.decision === 'no_go') changes.docs_stage = 'not_pursued';
    }
  }

  if (body.doc_mode !== undefined) changes.doc_mode = body.doc_mode;
  if (body.customer_facing !== undefined) changes.customer_facing = body.customer_facing ? 1 : 0;

  if (body.waivers !== undefined) {
    for (const [key, reason] of Object.entries(body.waivers as Record<string, unknown>)) {
      if (!DOC_KEYS.includes(key as DocKey)) return bad(`Unknown doc key: ${key}`);
      if (typeof reason !== 'string' || !reason.trim()) return bad(`Waiver for ${key} needs a reason`);
    }
    changes.waivers = JSON.stringify(body.waivers);
  }
  if (body.hub_url !== undefined) changes.hub_url = body.hub_url;
  if (body.one_pager_url !== undefined) changes.one_pager_url = body.one_pager_url;

  const updatedAt = now();
  await db.transaction(async (tx) => {
    await tx.update(projects).set({ ...changes, updated_at: updatedAt }).where(eq(projects.id, project.id)).run();
    await logActivity({
      actor: actorOf(req),
      type: 'project_docs_updated',
      project_id: project.id,
      summary: `Doc settings updated: ${Object.keys(changes).join(', ') || 'no changes'}`,
      detail: changes,
    }, tx);
  });

  const updated = { ...project, ...changes, updated_at: updatedAt };
  const item = updated.roadmap_item_id
    ? await db.select().from(roadmapItems).where(eq(roadmapItems.id, updated.roadmap_item_id)).get()
    : undefined;
  return res.json(serializeProject(updated, item));
}));

// DELETE /api/projects/:id  (archive)
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const project = await db.select().from(projects).where(eq(projects.id, req.params.id)).get();
  if (!project) return res.status(404).json({ error: 'Project not found' });
  await db.update(projects).set({ status: 'archived', updated_at: now() }).where(eq(projects.id, req.params.id)).run();
  return res.status(204).send();
}));

export default router;

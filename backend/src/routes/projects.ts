import { Router, Request, Response } from 'express';
import { eq, and, ne, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import { projects, tasks, roadmapItems } from '../db/schema';
import type { CreateProjectInput, UpdateProjectInput, ProjectDocsInput } from '../../../shared/types';
import { DOC_KEYS, type DocKey } from '../../../shared/doc-matrix';
import { serializeProject, TEAM_ABBREV, todayIso } from '../lib/doc-check';
import { actorOf, logActivity } from '../lib/activity';

const router = Router();

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
router.get('/archived', async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(projects).where(eq(projects.status, 'archived')).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch archived projects' });
  }
});

// POST /api/projects
router.post('/', async (req: Request, res: Response) => {
  const { name, description = '' }: CreateProjectInput = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const id = uuidv4();
  const ts = now();
  const project = { id, name: name.trim(), description, status: 'active' as const, created_at: ts, updated_at: ts };
  await db.insert(projects).values(project).run();
  return res.status(201).json(project);
});

// GET /api/projects/:id
router.get('/:id', async (req: Request, res: Response) => {
  const project = await db.select().from(projects).where(eq(projects.id, req.params.id)).get();
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const item = project.roadmap_item_id
    ? await db.select().from(roadmapItems).where(eq(roadmapItems.id, project.roadmap_item_id)).get()
    : undefined;
  return res.json(serializeProject(project, item));
});

// PUT /api/projects/:id
router.put('/:id', async (req: Request, res: Response) => {
  const { name, description, status }: UpdateProjectInput = req.body;
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
  return res.json(updated);
});

const DOCS_STAGES = ['proposal', 'roadmap', 'not_pursued'];
const DECISIONS = ['go', 'no_go', 'parked'];
const DOC_MODES = ['full', 'one_pager_only'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// PATCH /api/projects/:id/docs
router.patch('/:id/docs', async (req: Request, res: Response) => {
  const project = await db.select().from(projects).where(eq(projects.id, req.params.id)).get();
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const body: ProjectDocsInput = req.body ?? {};
  const changes: Partial<typeof project> = {};

  if (body.roadmap_item_id !== undefined) {
    if (body.roadmap_item_id === null) {
      changes.roadmap_item_id = null;
    } else {
      const item = await db.select().from(roadmapItems).where(eq(roadmapItems.id, body.roadmap_item_id)).get();
      if (!item) return res.status(400).json({ error: 'Unknown roadmap item' });
      const other = await db.select().from(projects)
        .where(and(eq(projects.roadmap_item_id, body.roadmap_item_id), ne(projects.id, project.id))).get();
      if (other) return res.status(409).json({ error: `Roadmap item already linked to "${other.name}"` });
      changes.roadmap_item_id = item.id;
      changes.docs_stage = 'roadmap';
      if (!project.team && item.team_name && TEAM_ABBREV[item.team_name]) changes.team = TEAM_ABBREV[item.team_name];
    }
  }

  if (body.docs_stage !== undefined) {
    if (body.docs_stage !== null && !DOCS_STAGES.includes(body.docs_stage)) return res.status(400).json({ error: 'Invalid docs_stage' });
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
      if (!DECISIONS.includes(body.decision)) return res.status(400).json({ error: 'Invalid decision' });
      if (!body.decision_reason?.trim()) return res.status(400).json({ error: 'decision_reason is required' });
      if (body.decision === 'parked' && !(body.revisit_by && ISO_DATE.test(body.revisit_by))) {
        return res.status(400).json({ error: 'revisit_by (YYYY-MM-DD) is required when parked' });
      }
      changes.decision = body.decision;
      changes.decision_reason = body.decision_reason.trim();
      changes.decision_date = todayIso();
      changes.revisit_by = body.decision === 'parked' ? body.revisit_by! : null;
      if (body.decision === 'no_go') changes.docs_stage = 'not_pursued';
    }
  }

  if (body.doc_mode !== undefined) {
    if (!DOC_MODES.includes(body.doc_mode)) return res.status(400).json({ error: 'Invalid doc_mode' });
    changes.doc_mode = body.doc_mode;
  }
  if (body.customer_facing !== undefined) changes.customer_facing = body.customer_facing ? 1 : 0;

  if (body.waivers !== undefined) {
    for (const [key, reason] of Object.entries(body.waivers)) {
      if (!DOC_KEYS.includes(key as DocKey)) return res.status(400).json({ error: `Unknown doc key: ${key}` });
      if (typeof reason !== 'string' || !reason.trim()) return res.status(400).json({ error: `Waiver for ${key} needs a reason` });
    }
    changes.waivers = JSON.stringify(body.waivers);
  }
  if (body.hub_url !== undefined) changes.hub_url = body.hub_url;
  if (body.one_pager_url !== undefined) changes.one_pager_url = body.one_pager_url;

  const updated = { ...project, ...changes, updated_at: now() };
  await db.update(projects).set(updated).where(eq(projects.id, project.id)).run();
  await logActivity({
    actor: actorOf(req),
    type: 'project_docs_updated',
    project_id: project.id,
    summary: `Doc settings updated: ${Object.keys(changes).join(', ') || 'no changes'}`,
    detail: changes,
  });

  const item = updated.roadmap_item_id
    ? await db.select().from(roadmapItems).where(eq(roadmapItems.id, updated.roadmap_item_id)).get()
    : undefined;
  return res.json(serializeProject(updated, item));
});

// DELETE /api/projects/:id  (archive)
router.delete('/:id', async (req: Request, res: Response) => {
  const project = await db.select().from(projects).where(eq(projects.id, req.params.id)).get();
  if (!project) return res.status(404).json({ error: 'Project not found' });
  await db.update(projects).set({ status: 'archived', updated_at: now() }).where(eq(projects.id, req.params.id)).run();
  return res.status(204).send();
});

export default router;

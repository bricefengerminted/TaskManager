import { Router, Request, Response } from 'express';
import { eq, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import { projects, tasks } from '../db/schema';
import type { CreateProjectInput, UpdateProjectInput } from '../../../shared/types';

const router = Router();

function now() {
  return new Date().toISOString();
}

// GET /api/projects
router.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(projects).where(eq(projects.status, 'active')).all();

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

      return { ...p, task_counts: taskCounts };
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
  return res.json(project);
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

// DELETE /api/projects/:id  (archive)
router.delete('/:id', async (req: Request, res: Response) => {
  const project = await db.select().from(projects).where(eq(projects.id, req.params.id)).get();
  if (!project) return res.status(404).json({ error: 'Project not found' });
  await db.update(projects).set({ status: 'archived', updated_at: now() }).where(eq(projects.id, req.params.id)).run();
  return res.status(204).send();
});

export default router;

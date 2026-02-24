import { Router, Request, Response } from 'express';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import { tasks, projects } from '../db/schema';
import type { CreateTaskInput, UpdateTaskInput } from '../../../shared/types';

const router = Router({ mergeParams: true });

function now() {
  return new Date().toISOString();
}

// GET /api/projects/:projectId/tasks
router.get('/', async (req: Request, res: Response) => {
  const project = await db.select().from(projects).where(eq(projects.id, req.params.projectId)).get();
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const rows = await db.select().from(tasks).where(eq(tasks.project_id, req.params.projectId)).all();
  return res.json(rows);
});

// POST /api/projects/:projectId/tasks
router.post('/', async (req: Request, res: Response) => {
  const project = await db.select().from(projects).where(eq(projects.id, req.params.projectId)).get();
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const {
    title,
    description = '',
    status = 'todo',
    priority = 'medium',
    due_date = null,
    source = 'manual',
    slack_raw = null,
  }: CreateTaskInput = req.body;

  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });

  const id = uuidv4();
  const ts = now();
  const task = {
    id,
    project_id: req.params.projectId,
    title: title.trim(),
    description,
    status: status as 'todo' | 'in_progress' | 'done',
    priority: priority as 'low' | 'medium' | 'high' | 'urgent',
    due_date: due_date ?? null,
    source: source as 'manual' | 'slack',
    slack_raw: slack_raw ?? null,
    created_at: ts,
    updated_at: ts,
  };
  await db.insert(tasks).values(task).run();
  return res.status(201).json(task);
});

// GET /api/projects/:projectId/tasks/:taskId
router.get('/:taskId', async (req: Request, res: Response) => {
  const task = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, req.params.taskId), eq(tasks.project_id, req.params.projectId)))
    .get();
  if (!task) return res.status(404).json({ error: 'Task not found' });
  return res.json(task);
});

// PUT /api/projects/:projectId/tasks/:taskId
router.put('/:taskId', async (req: Request, res: Response) => {
  const task = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, req.params.taskId), eq(tasks.project_id, req.params.projectId)))
    .get();
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const { title, description, status, priority, due_date }: UpdateTaskInput = req.body;

  const updated = {
    ...task,
    title: title?.trim() ?? task.title,
    description: description ?? task.description,
    status: (status ?? task.status) as 'todo' | 'in_progress' | 'done',
    priority: (priority ?? task.priority) as 'low' | 'medium' | 'high' | 'urgent',
    due_date: due_date !== undefined ? due_date : task.due_date,
    updated_at: now(),
  };
  await db.update(tasks).set(updated).where(eq(tasks.id, req.params.taskId)).run();
  return res.json(updated);
});

// DELETE /api/projects/:projectId/tasks/:taskId
router.delete('/:taskId', async (req: Request, res: Response) => {
  const task = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, req.params.taskId), eq(tasks.project_id, req.params.projectId)))
    .get();
  if (!task) return res.status(404).json({ error: 'Task not found' });
  await db.delete(tasks).where(eq(tasks.id, req.params.taskId)).run();
  return res.status(204).send();
});

// PATCH /api/projects/:projectId/tasks/:taskId/status
router.patch('/:taskId/status', async (req: Request, res: Response) => {
  const task = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, req.params.taskId), eq(tasks.project_id, req.params.projectId)))
    .get();
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const { status } = req.body;
  if (!['todo', 'in_progress', 'done'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const updated = { ...task, status, updated_at: now() };
  await db.update(tasks).set(updated).where(eq(tasks.id, req.params.taskId)).run();
  return res.json(updated);
});

export default router;

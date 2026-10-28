import { Router, Request, Response } from 'express';
import { eq, and, sql, asc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import { tasks, projects } from '../db/schema';
import type { CreateTaskInput, UpdateTaskInput } from '../../../shared/types';

import { asyncHandler } from '../lib/async-handler';
const router = Router({ mergeParams: true });

function now() {
  return new Date().toISOString();
}

// Parse JSON columns (images, links) into arrays for API responses
function parseTaskRow(row: any) {
  if (!row) return row;
  return {
    ...row,
    images: JSON.parse(row.images || '[]'),
    links: JSON.parse(row.links || '[]'),
  };
}

// GET /api/projects/:projectId/tasks
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const project = await db.select().from(projects).where(eq(projects.id, req.params.projectId)).get();
  if (!project) return res.status(404).json({ error: 'Project not found' });

  let rows = await db.select().from(tasks)
    .where(eq(tasks.project_id, req.params.projectId))
    .orderBy(asc(tasks.position))
    .all();

  // Optional filters (applied in JS — dataset is single-user small)
  const docTypeFilter = req.query.doc_type;
  if (typeof docTypeFilter === 'string' && docTypeFilter.length > 0) {
    rows = rows.filter((r) => r.doc_type === docTypeFilter);
  }
  const dueWithin = req.query.due_within_days;
  if (dueWithin !== undefined) {
    const n = parseInt(String(dueWithin), 10);
    if (!Number.isNaN(n)) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + n);
      const cutoffStr = cutoff.toISOString().split('T')[0];
      // due_date is 'YYYY-MM-DD' — lexical <= is correct for ISO dates; includes overdue
      rows = rows.filter((r) => r.due_date != null && r.due_date <= cutoffStr);
    }
  }

  return res.json(rows.map(parseTaskRow));
}));

// POST /api/projects/:projectId/tasks
router.post('/', asyncHandler(async (req: Request, res: Response) => {
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
    links = [],
    doc_type = null,
  }: CreateTaskInput = req.body;

  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });

  // Shift existing tasks in this status column down to make room at position 0
  await db.update(tasks)
    .set({ position: sql`${tasks.position} + 1` })
    .where(and(eq(tasks.project_id, req.params.projectId), eq(tasks.status, status as any)))
    .run();

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
    position: 0,
    images: '[]',
    links: JSON.stringify(links ?? []),
    doc_type: doc_type ?? null,
    source: source as 'manual' | 'slack',
    slack_raw: slack_raw ?? null,
    created_at: ts,
    updated_at: ts,
  };
  await db.insert(tasks).values(task).run();
  return res.status(201).json(parseTaskRow(task));
}));

// PATCH /api/projects/:projectId/tasks/reorder
// Body: { columns: { [status: string]: string[] } }
// Each key is a status, value is ordered array of task IDs
router.patch('/reorder', asyncHandler(async (req: Request, res: Response) => {
  const { columns } = req.body as { columns: Record<string, string[]> };
  if (!columns) return res.status(400).json({ error: 'columns is required' });

  const ts = now();
  for (const [status, taskIds] of Object.entries(columns)) {
    for (let i = 0; i < taskIds.length; i++) {
      await db.update(tasks)
        .set({ status: status as any, position: i, updated_at: ts })
        .where(and(eq(tasks.id, taskIds[i]), eq(tasks.project_id, req.params.projectId)))
        .run();
    }
  }

  // Return updated tasks for this project
  const rows = await db.select().from(tasks)
    .where(eq(tasks.project_id, req.params.projectId))
    .orderBy(asc(tasks.position))
    .all();
  return res.json(rows.map(parseTaskRow));
}));

// GET /api/projects/:projectId/tasks/:taskId
router.get('/:taskId', asyncHandler(async (req: Request, res: Response) => {
  const task = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, req.params.taskId), eq(tasks.project_id, req.params.projectId)))
    .get();
  if (!task) return res.status(404).json({ error: 'Task not found' });
  return res.json(parseTaskRow(task));
}));

// PUT /api/projects/:projectId/tasks/:taskId
router.put('/:taskId', asyncHandler(async (req: Request, res: Response) => {
  const task = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, req.params.taskId), eq(tasks.project_id, req.params.projectId)))
    .get();
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const { title, description, status, priority, due_date, images, links, doc_type }: UpdateTaskInput = req.body;

  const updated = {
    ...task,
    title: title?.trim() ?? task.title,
    description: description ?? task.description,
    status: (status ?? task.status) as 'todo' | 'in_progress' | 'done',
    priority: (priority ?? task.priority) as 'low' | 'medium' | 'high' | 'urgent',
    due_date: due_date !== undefined ? due_date : task.due_date,
    images: images !== undefined ? JSON.stringify(images) : task.images,
    links: links !== undefined ? JSON.stringify(links) : task.links,
    doc_type: doc_type !== undefined ? doc_type : task.doc_type,
    updated_at: now(),
  };
  await db.update(tasks).set(updated).where(eq(tasks.id, req.params.taskId)).run();
  return res.json(parseTaskRow(updated));
}));

// DELETE /api/projects/:projectId/tasks/:taskId
router.delete('/:taskId', asyncHandler(async (req: Request, res: Response) => {
  const task = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, req.params.taskId), eq(tasks.project_id, req.params.projectId)))
    .get();
  if (!task) return res.status(404).json({ error: 'Task not found' });
  await db.delete(tasks).where(eq(tasks.id, req.params.taskId)).run();
  return res.status(204).send();
}));

// PATCH /api/projects/:projectId/tasks/:taskId/status
router.patch('/:taskId/status', asyncHandler(async (req: Request, res: Response) => {
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
  return res.json(parseTaskRow(updated));
}));

export default router;

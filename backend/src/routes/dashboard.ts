import { Router, Request, Response } from 'express';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { projects, tasks } from '../db/schema';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  try {
    const activeProjects = db.select().from(projects).where(eq(projects.status, 'active')).all();

    const taskStatusCounts = db
      .select({ status: tasks.status, count: sql<number>`count(*)`.as('count') })
      .from(tasks)
      .groupBy(tasks.status)
      .all();

    const tasksByStatus = { todo: 0, in_progress: 0, done: 0 };
    let totalTasks = 0;
    for (const c of taskStatusCounts) {
      const n = Number(c.count);
      totalTasks += n;
      if (c.status === 'todo') tasksByStatus.todo = n;
      if (c.status === 'in_progress') tasksByStatus.in_progress = n;
      if (c.status === 'done') tasksByStatus.done = n;
    }

    const today = new Date().toISOString().split('T')[0];
    const overdueResult = db
      .select({ count: sql<number>`count(*)`.as('count') })
      .from(tasks)
      .where(sql`${tasks.due_date} IS NOT NULL AND ${tasks.due_date} < ${today} AND ${tasks.status} != 'done'`)
      .get();
    const overdueTasks = Number(overdueResult?.count ?? 0);

    const projectsWithCounts = activeProjects.map((p) => {
      const counts = db
        .select({ status: tasks.status, count: sql<number>`count(*)`.as('count') })
        .from(tasks)
        .where(eq(tasks.project_id, p.id))
        .groupBy(tasks.status)
        .all();

      const tc = { todo: 0, in_progress: 0, done: 0, overdue: 0 };
      for (const c of counts) {
        if (c.status === 'todo') tc.todo = Number(c.count);
        if (c.status === 'in_progress') tc.in_progress = Number(c.count);
        if (c.status === 'done') tc.done = Number(c.count);
      }

      const overdueProj = db
        .select({ count: sql<number>`count(*)`.as('count') })
        .from(tasks)
        .where(
          sql`${tasks.project_id} = ${p.id} AND ${tasks.due_date} IS NOT NULL AND ${tasks.due_date} < ${today} AND ${tasks.status} != 'done'`
        )
        .get();
      tc.overdue = Number(overdueProj?.count ?? 0);

      return { ...p, task_counts: tc };
    });

    res.json({
      total_projects: activeProjects.length,
      total_tasks: totalTasks,
      tasks_by_status: tasksByStatus,
      overdue_tasks: overdueTasks,
      projects: projectsWithCounts,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

export default router;

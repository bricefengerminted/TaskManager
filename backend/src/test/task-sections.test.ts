import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../index';
import { createProject } from './helpers';
import { isSectionTitle, sectionName } from '../../../shared/task-sections';

describe('phase divider tasks', () => {
  it('recognises divider titles', () => {
    expect(isSectionTitle('━━━ PLAN ━━━')).toBe(true);
    expect(isSectionTitle('—— Build ——')).toBe(true);
    expect(isSectionTitle('[Plan] Write PRD')).toBe(false);
    expect(isSectionTitle('— one dash')).toBe(false);
    expect(sectionName('━━━ MEASURE ━━━')).toBe('MEASURE');
  });

  it('leaves dividers out of project and dashboard counts', async () => {
    const p = await createProject('Counts');
    for (const title of ['━━━ PLAN ━━━', '━━━ BUILD ━━━', 'Real task']) {
      await request(app).post(`/api/projects/${p.id}/tasks`).send({ title, due_date: '2020-01-01' });
    }
    const projects = await request(app).get('/api/projects');
    const counts = projects.body.find((x: any) => x.id === p.id).task_counts;
    expect(counts).toMatchObject({ todo: 1, overdue: 1 });

    const dash = await request(app).get('/api/dashboard');
    expect(dash.body.projects.find((x: any) => x.id === p.id).task_counts).toMatchObject({ todo: 1, overdue: 1 });
    expect(dash.body.total_tasks).toBe(dash.body.tasks_by_status.todo + dash.body.tasks_by_status.in_progress + dash.body.tasks_by_status.done);
  });
});

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../index';
import { client } from '../db';
import { linkedModularProject, modularItem, sync, createProject } from './helpers';

const TODAY = '2026-10-28';
const apply = (body: Record<string, unknown>) =>
  request(app).post('/api/docs/apply').set('X-Actor', 'claude').send({ today: TODAY, ...body });
const resolve = (body: Record<string, unknown>) => request(app).post('/api/docs/resolve-conflict').send(body);
const sql = async (q: string, args: any[] = []) => (await client.execute({ sql: q, args })).rows as any[];
const task = async (pid: string, key: string) =>
  (await sql(`SELECT * FROM tasks WHERE project_id=? AND doc_key=?`, [pid, key]))[0];
const phases = (buildStart?: string) => ({
  discovery: { start: '2026-03-01', end: '2026-03-30' },
  ...(buildStart ? { build: { start: buildStart, end: '2026-11-10' } } : {}),
  measure: { start: '2026-11-10', end: '2026-12-01' },
});

describe('due_computed survives an undated sync', () => {
  it('re-dates after the build start disappears and comes back', async () => {
    const p = await linkedModularProject();
    await apply({ project_id: p.id });
    await sync([modularItem({ phases: phases() })]);
    await apply({ project_id: p.id });
    expect((await task(p.id, 'prd')).due_computed).toBe('2026-07-21');
    await sync([modularItem({ phases: phases('2026-08-18') })]);
    const res = await apply({ project_id: p.id });
    const prd = await task(p.id, 'prd');
    expect(prd.due_date).toBe('2026-08-04');
    expect(res.body.conflicts.map((c: any) => c.doc_key)).not.toContain('prd');
  });
});

describe('conflict resolution', () => {
  async function conflicted() {
    const p = await linkedModularProject();
    await apply({ project_id: p.id });
    await sql(`UPDATE tasks SET due_date='2026-12-25' WHERE project_id=? AND doc_key='prd'`, [p.id]);
    const res = await apply({ project_id: p.id });
    expect(res.body.conflicts.map((c: any) => c.doc_key)).toContain('prd');
    return { p, id: (await task(p.id, 'prd')).id as string };
  }

  it('accept moves the date and clears the conflict', async () => {
    const { p, id } = await conflicted();
    const r = await resolve({ task_id: id, action: 'accept' });
    expect(r.status).toBe(200);
    expect((await task(p.id, 'prd')).due_date).toBe('2026-07-21');
    expect((await apply({ project_id: p.id })).body.conflicts).toEqual([]);
    const log = await sql(`SELECT detail FROM activity WHERE type='doc_due_conflict_resolved'`);
    expect(JSON.parse(log[0].detail)).toMatchObject({ action: 'accept', from: '2026-12-25', to: '2026-07-21' });
  });

  it('keep stops the conflict and survives a roadmap move', async () => {
    const { p, id } = await conflicted();
    expect((await resolve({ task_id: id, action: 'keep' })).status).toBe(200);
    expect((await apply({ project_id: p.id })).body.conflicts).toEqual([]);
    await sync([modularItem({ phases: phases('2026-08-18') })]);
    const res = await apply({ project_id: p.id });
    const prd = await task(p.id, 'prd');
    expect(prd.due_date).toBe('2026-12-25');
    expect(prd.due_computed).toBe('2026-08-04');
    expect(res.body.conflicts).toEqual([]);
    expect(res.body.redated.map((r: any) => r.doc_key)).not.toContain('prd');
  });

  it('accept after keep unpins', async () => {
    const { p, id } = await conflicted();
    await resolve({ task_id: id, action: 'keep' });
    await resolve({ task_id: id, action: 'accept' });
    expect((await task(p.id, 'prd')).due_pinned).toBe(0);
  });

  it('rejects bad requests', async () => {
    const p = await linkedModularProject();
    await sql(`INSERT INTO tasks (id, project_id, title, created_at, updated_at) VALUES ('plain', ?, 't', 'x', 'x')`, [p.id]);
    await sql(`INSERT INTO tasks (id, project_id, title, doc_key, created_at, updated_at) VALUES ('nocomp', ?, 't', 'prd', 'x', 'x')`, [p.id]);
    expect((await resolve({ task_id: 'missing', action: 'keep' })).status).toBe(400);
    expect((await resolve({ task_id: 'plain', action: 'keep' })).status).toBe(400);
    expect((await resolve({ task_id: 'nocomp', action: 'accept' })).status).toBe(400);
    expect((await resolve({ task_id: 'nocomp', action: 'bogus' })).status).toBe(400);
    expect((await resolve({ action: 'keep' })).status).toBe(400);
  });

  it('done tasks are not listed as conflicts', async () => {
    const { p, id } = await conflicted();
    await sql(`UPDATE tasks SET status='done' WHERE id=?`, [id]);
    expect((await apply({ project_id: p.id })).body.conflicts).toEqual([]);
  });
});

describe('PUT /api/projects/:id', () => {
  it('validates name and status and writes only its fields', async () => {
    const a = await createProject('A');
    expect((await request(app).put(`/api/projects/${a.id}`).send({ name: 5 })).status).toBe(400);
    expect((await request(app).put(`/api/projects/${a.id}`).send({ status: 'bogus' })).status).toBe(400);
    const ok = await request(app).put(`/api/projects/${a.id}`).send({ name: 'B', status: 'archived' });
    expect(ok.body).toMatchObject({ name: 'B', status: 'archived' });
  });
});

describe('error handler and PATCH rules', () => {
  it('keeps a 413 a 413', async () => {
    const res = await request(app).post('/api/projects').send({ name: 'x'.repeat(200_000) });
    expect(res.status).toBe(413);
  });

  it('rejects docs_stage changes on a project that stays linked, and link + no_go', async () => {
    const p = await linkedModularProject();
    const patch = (b: Record<string, unknown>) => request(app).patch(`/api/projects/${p.id}/docs`).send(b);
    expect((await patch({ docs_stage: 'proposal' })).status).toBe(400);
    expect((await patch({ docs_stage: 'roadmap' })).status).toBe(200);
    const q = await request(app).post('/api/projects').send({ name: 'Q' });
    await sync([modularItem({ id: 'other', name: 'Other', jiraKey: 'IDEA-1' })]);
    const res = await request(app).patch(`/api/projects/${q.body.id}/docs`).send({ roadmap_item_id: 'other', decision: 'no_go', decision_reason: 'x' });
    expect(res.status).toBe(400);
  });
});

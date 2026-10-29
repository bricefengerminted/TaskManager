import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../index';
import { client } from '../db';
import { runMigrations } from '../db/migrate';
import { linkedModularProject, modularItem, sync } from './helpers';

const TODAY = '2026-10-28';
const apply = (body: Record<string, unknown>) =>
  request(app).post('/api/docs/apply').set('X-Actor', 'claude').send({ today: TODAY, ...body });
const sql = async (q: string, args: any[] = []) => (await client.execute({ sql: q, args })).rows as any[];
const task = async (pid: string, key: string) =>
  (await sql(`SELECT * FROM tasks WHERE project_id=? AND doc_key=?`, [pid, key]))[0];
const health = async (pid: string) =>
  (await request(app).get(`/api/docs/health?project_id=${pid}&today=${TODAY}`)).body.projects[0];

describe('waived rows', () => {
  it('produce no conflicts or conflict logs', async () => {
    const p = await linkedModularProject();
    await apply({ project_id: p.id });
    await sql(`UPDATE tasks SET due_date='2026-12-30' WHERE project_id=? AND doc_key='release_notes'`, [p.id]);
    await request(app).patch(`/api/projects/${p.id}/docs`).send({ waivers: { release_notes: 'not needed' } });
    await sync([modularItem({ phases: { discovery: { start: '2026-03-01', end: '2026-03-30' }, build: { start: '2026-08-04', end: '2026-11-10' }, measure: { start: '2026-11-17', end: '2026-12-01' } } })]);
    const res = await apply({ project_id: p.id });
    expect(res.body.conflicts.map((c: any) => c.doc_key)).not.toContain('release_notes');
    expect(res.body.redated.map((c: any) => c.doc_key)).not.toContain('release_notes');
    expect(Number((await sql(`SELECT count(*) c FROM activity WHERE type='doc_due_conflict'`))[0].c)).toBe(0);
  });
});

describe('pinned dates drive status', () => {
  it('health shows the kept date with rule Pinned; apply keeps due_computed as the matrix value', async () => {
    const p = await linkedModularProject();
    await apply({ project_id: p.id });
    await sql(`UPDATE tasks SET due_date='2026-12-25' WHERE project_id=? AND doc_key='prd'`, [p.id]);
    const id = (await task(p.id, 'prd')).id;
    await request(app).post('/api/docs/resolve-conflict').send({ task_id: id, action: 'keep' });
    const prd = (await health(p.id)).rows.find((r: any) => r.key === 'prd');
    expect(prd).toMatchObject({ due: '2026-12-25', due_rule: 'Pinned', status: 'missing' });
    await apply({ project_id: p.id });
    const t = await task(p.id, 'prd');
    expect(t.due_computed).toBe('2026-07-21');
    expect(t.due_rule).toBe('Build start −2w');
  });
});

describe('doc_type backfill', () => {
  it('fixes mismatched doc_type idempotently', async () => {
    const p = await linkedModularProject();
    await sql(`INSERT INTO tasks (id, project_id, title, doc_key, doc_type, created_at, updated_at) VALUES ('a', ?, 't', 'experiment_brief.results', 'other', 'x', 'x')`, [p.id]);
    await sql(`INSERT INTO tasks (id, project_id, title, doc_key, doc_type, created_at, updated_at) VALUES ('b', ?, 'Write PRD', NULL, NULL, 'x', 'x')`, [p.id]);
    await runMigrations();
    await runMigrations();
    expect((await sql(`SELECT doc_type FROM tasks WHERE id='a'`))[0].doc_type).toBe('experiment_brief');
    const b = (await sql(`SELECT doc_key, doc_type FROM tasks WHERE id='b'`))[0];
    expect(b).toMatchObject({ doc_key: 'prd', doc_type: 'prd' });
  });
});

describe('hub flag and link fallback', () => {
  it('no_hub is false when the roadmap item has a hub link', async () => {
    const p = await linkedModularProject({ links: { hub: 'https://minted.atlassian.net/wiki/spaces/PM/pages/9/Hub' } });
    expect((await health(p.id)).flags).not.toContain('no_hub');
  });

  it('empty-string roadmap links fall back to the project URL', async () => {
    const p = await linkedModularProject({ links: { hub: '' } });
    await request(app).patch(`/api/projects/${p.id}/docs`).send({ hub_url: 'https://minted.atlassian.net/wiki/spaces/PM/pages/9/Hub' });
    const hub = (await health(p.id)).rows.find((r: any) => r.key === 'hub');
    expect(hub.status).toBe('done');
  });
});

describe('dashboard', () => {
  it('serialises projects', async () => {
    await linkedModularProject();
    const res = await request(app).get('/api/dashboard');
    const row = res.body.projects.find((x: any) => x.name.startsWith('[IDEA-932]'));
    expect(row.waivers).toEqual({});
    expect(row.dev_start_half).toBe('2026-H2');
  });
});

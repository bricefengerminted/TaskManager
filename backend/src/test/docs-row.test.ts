import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../index';
import { client } from '../db';
import { linkedModularProject } from './helpers';

const TODAY = '2026-10-28';
const apply = (body: Record<string, unknown>) =>
  request(app).post('/api/docs/apply').set('X-Actor', 'claude').send({ today: TODAY, ...body });
const edit = (body: Record<string, unknown>) => request(app).post('/api/docs/row').send({ today: TODAY, ...body });
const sql = async (q: string, args: any[] = []) => (await client.execute({ sql: q, args })).rows as any[];
const task = async (pid: string, key: string) =>
  (await sql(`SELECT * FROM tasks WHERE project_id=? AND doc_key=?`, [pid, key]))[0];
const rowOf = (body: any, key: string) => body.rows.find((r: any) => r.key === key);

describe('POST /api/docs/row', () => {
  it('records a link and marks the doc done', async () => {
    const p = await linkedModularProject();
    await apply({ project_id: p.id });
    const url = 'https://minted.atlassian.net/wiki/spaces/PM/pages/123';
    let r = await edit({ project_id: p.id, doc_key: 'prd', link: url });
    expect(r.status).toBe(200);
    expect(rowOf(r.body, 'prd').link).toBe(url);
    expect(JSON.parse((await task(p.id, 'prd')).doc_evidence)).toMatchObject({ page_url: url, published: true });
    r = await edit({ project_id: p.id, doc_key: 'prd', done: true });
    expect(rowOf(r.body, 'prd').status).toBe('done');
    r = await edit({ project_id: p.id, doc_key: 'prd', done: false });
    expect(rowOf(r.body, 'prd').status).not.toBe('done');
  });

  it('refuses done without a link, and treats a draft link as unpublished', async () => {
    const p = await linkedModularProject();
    await apply({ project_id: p.id });
    expect((await edit({ project_id: p.id, doc_key: 'prd', done: true })).status).toBe(400);
    await edit({ project_id: p.id, doc_key: 'prd', link: 'https://minted.atlassian.net/wiki/pages/resumedraft.action?draftId=9' });
    expect(JSON.parse((await task(p.id, 'prd')).doc_evidence).published).toBe(false);
  });

  it('marking a waived doc done drops the waiver', async () => {
    const p = await linkedModularProject();
    await apply({ project_id: p.id });
    await request(app).patch(`/api/projects/${p.id}/docs`).send({ waivers: { prd: 'not needed' } });
    await edit({ project_id: p.id, doc_key: 'prd', link: 'https://minted.atlassian.net/wiki/spaces/PM/pages/123' });
    const r = await edit({ project_id: p.id, doc_key: 'prd', done: true });
    expect(r.status).toBe(200);
    expect(rowOf(r.body, 'prd').status).toBe('done');
    expect(JSON.parse((await sql(`SELECT waivers FROM projects WHERE id=?`, [p.id]))[0].waivers)).not.toHaveProperty('prd');
  });

  it('pins a due date and unpins it back to the rule', async () => {
    const p = await linkedModularProject();
    await apply({ project_id: p.id });
    const computed = (await task(p.id, 'prd')).due_computed;
    let r = await edit({ project_id: p.id, doc_key: 'prd', due_date: '2026-12-01' });
    expect(rowOf(r.body, 'prd')).toMatchObject({ due: '2026-12-01', due_rule: 'Pinned' });
    r = await edit({ project_id: p.id, doc_key: 'prd', due_date: null });
    expect(rowOf(r.body, 'prd').due).toBe(computed);
    expect((await task(p.id, 'prd')).due_pinned).toBe(0);
  });

  it('sets the hub link on the project', async () => {
    const p = await linkedModularProject();
    const url = 'https://minted.atlassian.net/wiki/spaces/PM/pages/456';
    const r = await edit({ project_id: p.id, doc_key: 'hub', link: url });
    expect(r.status).toBe(200);
    expect(r.body.hub_url).toBe(url);
    expect(rowOf(r.body, 'hub').status).toBe('done');
  });

  it('rejects bad input', async () => {
    const p = await linkedModularProject();
    expect((await edit({ project_id: p.id, doc_key: 'nope' })).status).toBe(400);
    expect((await edit({ project_id: p.id, doc_key: 'prd', link: 'javascript:alert(1)' })).status).toBe(400);
    expect((await edit({ project_id: p.id, doc_key: 'prd', due_date: '2026-02-30' })).status).toBe(400);
  });
});

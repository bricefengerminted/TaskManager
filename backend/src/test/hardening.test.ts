import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../index';
import { client } from '../db';
import { createProject, linkedModularProject, modularItem, sync } from './helpers';

const TODAY = '2026-10-28';
const apply = (body: Record<string, unknown>) =>
  request(app).post('/api/docs/apply').set('X-Actor', 'claude').send({ today: TODAY, ...body });
const patch = (id: string, body: Record<string, unknown>) =>
  request(app).patch(`/api/projects/${id}/docs`).send(body);
const alive = async () => expect((await request(app).get('/api/health')).status).toBe(200);

describe('malformed bodies return 400 and the server survives', () => {
  it('apply', async () => {
    const p = await linkedModularProject();
    expect((await apply({ project_id: p.id, evidence: null })).status).toBe(400);
    expect((await apply({})).status).toBe(400);
    expect((await apply({ project_id: 5 })).status).toBe(400);
    expect((await apply({ project_id: p.id, evidence: { prd: { page_url: 5 } } })).status).toBe(400);
    expect((await apply({ project_id: p.id, evidence: { prd: { published: 'yes' } } })).status).toBe(400);
    expect((await apply({ project_id: p.id, evidence: [] })).status).toBe(400);
    expect((await apply({ project_id: p.id, today: '2026-02-31' })).status).toBe(400);
    expect((await apply({ project_id: p.id, evidence: { prd: null } })).status).toBe(200);
    await alive();
  });

  it('PATCH docs', async () => {
    const p = await createProject('X');
    expect((await patch(p.id, { waivers: null })).status).toBe(400);
    expect((await patch(p.id, { waivers: [] })).status).toBe(400);
    expect((await patch(p.id, { decision: 'go', decision_reason: 5 })).status).toBe(400);
    expect((await patch(p.id, { customer_facing: 'yes' })).status).toBe(400);
    await alive();
  });

  it('sync validates every item before writing any', async () => {
    expect((await sync([modularItem({ name: 5 })])).status).toBe(400);
    expect((await sync([modularItem({ stage: 'bogus' })])).status).toBe(400);
    expect((await sync([modularItem(), modularItem({ id: 'b', name: 5 })])).status).toBe(400);
    expect((await request(app).get('/api/roadmap')).body).toEqual([]);
    expect((await request(app).post('/api/roadmap/sync').send({ items: [null] })).status).toBe(400);
    await alive();
  });
});

describe('PATCH docs validation', () => {
  it('validates team and urls', async () => {
    const p = await createProject('X');
    expect((await patch(p.id, { team: 'XX' })).status).toBe(400);
    expect((await patch(p.id, { team: 'OI' })).status).toBe(200);
    expect((await patch(p.id, { team: null })).status).toBe(200);
    expect((await patch(p.id, { hub_url: 'javascript:alert(1)' })).status).toBe(400);
    expect((await patch(p.id, { one_pager_url: 'http://x' })).status).toBe(400);
    expect((await patch(p.id, { hub_url: 'https://x.atlassian.net/wiki/1' })).status).toBe(200);
  });

  it('keeps docs_stage consistent with linking', async () => {
    await sync([modularItem()]);
    const p = await createProject('X');
    expect((await patch(p.id, { docs_stage: 'roadmap' })).status).toBe(400);
    expect((await patch(p.id, { roadmap_item_id: 'ww-modular', docs_stage: 'proposal' })).status).toBe(400);
    expect((await patch(p.id, { roadmap_item_id: 'ww-modular', docs_stage: 'roadmap' })).status).toBe(200);
    const un = await patch(p.id, { roadmap_item_id: null });
    expect(un.body.docs_stage).toBe('proposal');
    expect(un.body.roadmap_item_id).toBeNull();
    const un2 = await patch(p.id, { roadmap_item_id: 'ww-modular' });
    expect(un2.body.docs_stage).toBe('roadmap');
    expect((await patch(p.id, { roadmap_item_id: null, docs_stage: 'not_pursued' })).body.docs_stage).toBe('not_pursued');
  });

  it('rejects contradictory decisions and bad dates', async () => {
    const p = await createProject('X');
    expect((await patch(p.id, { decision: 'no_go', decision_reason: 'x', docs_stage: 'proposal' })).status).toBe(400);
    expect((await patch(p.id, { decision: 'parked', decision_reason: 'x', revisit_by: '2026-02-31' })).status).toBe(400);
    expect((await patch(p.id, { decision: 'parked', decision_reason: 'x', revisit_by: '2027-01-15' })).status).toBe(200);
  });

  it('re-sending the same decision keeps its date', async () => {
    const p = await createProject('X');
    await patch(p.id, { decision: 'go', decision_reason: 'ok' });
    await client.execute({ sql: `UPDATE projects SET decision_date='2026-01-01' WHERE id=?`, args: [p.id] });
    const res = await patch(p.id, { decision: 'go', decision_reason: 'ok' });
    expect(res.body.decision_date).toBe('2026-01-01');
    const changed = await patch(p.id, { decision: 'parked', decision_reason: 'later', revisit_by: '2027-01-15' });
    expect(changed.body.decision_date).not.toBe('2026-01-01');
  });
});

describe('consistent project serialisation', () => {
  it('PUT, POST and archived return waivers as an object', async () => {
    const post = await request(app).post('/api/projects').send({ name: 'Y' });
    expect(post.body.waivers).toEqual({});
    expect(post.body.customer_facing).toBe(false);
    const put = await request(app).put(`/api/projects/${post.body.id}`).send({ description: 'd' });
    expect(put.body.waivers).toEqual({});
    await request(app).delete(`/api/projects/${post.body.id}`);
    const arch = await request(app).get('/api/projects/archived');
    expect(arch.body.find((x: any) => x.id === post.body.id).waivers).toEqual({});
  });
});

describe('query validation and sync linking', () => {
  it('health validates today and status', async () => {
    expect((await request(app).get('/api/docs/health?today=nope')).status).toBe(400);
    expect((await request(app).get('/api/docs/health?status=bogus')).status).toBe(400);
    expect((await request(app).get('/api/docs/health?today=2026-10-28&status=overdue')).status).toBe(200);
  });

  it('sync counts archived projects as linked', async () => {
    const p = await linkedModularProject();
    await request(app).delete(`/api/projects/${p.id}`);
    const res = await sync([modularItem()]);
    expect(res.body.unlinked).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../index';
import { client } from '../db';
import { createProject, linkedModularProject, sync, modularItem } from './helpers';
import { todayIso } from '../lib/doc-check';

describe('PATCH /api/projects/:id/docs', () => {
  it('links a roadmap item and defaults the team', async () => {
    const p = await linkedModularProject();
    expect(p).toMatchObject({ roadmap_item_id: 'ww-modular', docs_stage: 'roadmap', team: 'WW', doc_mode: 'full', customer_facing: false, waivers: {} });
    const list = await request(app).get('/api/projects');
    const row = list.body.find((x: any) => x.id === p.id);
    expect(row.dev_start_half).toBe('2026-H2');
    expect(row.roadmap_stage).toBe('build');
  });

  it('rejects unknown and already-linked items', async () => {
    const a = await createProject('A');
    expect((await request(app).patch(`/api/projects/${a.id}/docs`).send({ roadmap_item_id: 'nope' })).status).toBe(400);
    await linkedModularProject();
    expect((await request(app).patch(`/api/projects/${a.id}/docs`).send({ roadmap_item_id: 'ww-modular' })).status).toBe(409);
  });

  it('records decisions', async () => {
    const p = await createProject('Idea');
    await request(app).patch(`/api/projects/${p.id}/docs`).send({ docs_stage: 'proposal' });
    expect((await request(app).patch(`/api/projects/${p.id}/docs`).send({ decision: 'go' })).status).toBe(400);
    expect((await request(app).patch(`/api/projects/${p.id}/docs`).send({ decision: 'parked', decision_reason: 'later' })).status).toBe(400);
    const res = await request(app).patch(`/api/projects/${p.id}/docs`).send({ decision: 'no_go', decision_reason: 'too small' });
    expect(res.status).toBe(200);
    expect(res.body.docs_stage).toBe('not_pursued');
    expect(res.body.decision_date).toBe(todayIso());
  });

  it('validates waivers', async () => {
    const p = await linkedModularProject();
    expect((await request(app).patch(`/api/projects/${p.id}/docs`).send({ waivers: { nope: 'x' } })).status).toBe(400);
    expect((await request(app).patch(`/api/projects/${p.id}/docs`).send({ waivers: { one_pager: ' ' } })).status).toBe(400);
    const ok = await request(app).patch(`/api/projects/${p.id}/docs`).send({ waivers: { one_pager: 'predates system' } });
    expect(ok.body.waivers).toEqual({ one_pager: 'predates system' });
  });

  it('logs each update', async () => {
    await sync([modularItem()]);
    const p = await createProject('X');
    await request(app).patch(`/api/projects/${p.id}/docs`).set('X-Actor', 'claude').send({ hub_url: 'https://minted.atlassian.net/wiki/x/1' });
    const r = await client.execute(`SELECT actor FROM activity WHERE type='project_docs_updated'`);
    expect(r.rows.map((x: any) => x.actor)).toEqual(['claude']);
  });
});

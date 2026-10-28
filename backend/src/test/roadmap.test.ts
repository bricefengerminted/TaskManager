import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../index';
import { client } from '../db';
import { modularItem, sync, createProject } from './helpers';

describe('roadmap sync', () => {
  it('upserts items and keeps first_seen_at', async () => {
    await sync([modularItem()]);
    const first = (await request(app).get('/api/roadmap')).body[0];
    await sync([modularItem({ stage: 'measure' })]);
    const res = await request(app).get('/api/roadmap');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].stage).toBe('measure');
    expect(res.body[0].first_seen_at).toBe(first.first_seen_at);
    expect(res.body[0].phases.build.start).toBe('2026-08-04');
    expect(res.body[0].team_name).toBe('Wedding Websites');
    expect(res.body[0].dev_start_half).toBe('2026-H2');
    expect(res.body[0].project_id).toBeNull();
  });

  it('suggests the project whose name carries the Jira key', async () => {
    const p = await createProject('[IDEA-932] Header / Main Elements Flexibility');
    const res = await sync([modularItem()]);
    expect(res.status).toBe(200);
    expect(res.body.upserted).toBe(1);
    expect(res.body.suggestions).toEqual([
      expect.objectContaining({ roadmap_item_id: 'ww-modular', project_id: p.id }),
    ]);
    expect(res.body.unlinked.map((u: any) => u.id)).toEqual(['ww-modular']);
  });

  it('rejects a body without items', async () => {
    const res = await request(app).post('/api/roadmap/sync').send({});
    expect(res.status).toBe(400);
  });

  it('logs the sync', async () => {
    await sync([modularItem()]);
    const r = await client.execute(`SELECT actor, type FROM activity WHERE type='roadmap_synced'`);
    expect(r.rows).toHaveLength(1);
    expect((r.rows[0] as any).actor).toBe('claude');
  });
});

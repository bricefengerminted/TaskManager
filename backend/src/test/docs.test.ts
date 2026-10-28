import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../index';
import { client } from '../db';
import { linkedModularProject, sync, modularItem } from './helpers';

const TODAY = '2026-10-28';
const apply = (body: Record<string, unknown>) =>
  request(app).post('/api/docs/apply').set('X-Actor', 'claude').send({ today: TODAY, ...body });

describe('docs apply', () => {
  it('creates one task per required doc', async () => {
    const p = await linkedModularProject();
    const res = await apply({ project_id: p.id });
    expect(res.status).toBe(200);
    expect(res.body.created.map((c: any) => c.doc_key)).toEqual([
      'hub', 'one_pager', 'prd', 'experiment_brief.plan', 'jira_epic',
      'release_notes', 'metrics_snapshot', 'experiment_brief.results',
    ]);
    const tasks = (await request(app).get(`/api/projects/${p.id}/tasks`)).body;
    const prd = tasks.find((t: any) => t.doc_key === 'prd');
    expect(prd).toMatchObject({ title: 'Doc: Brief/PRD', doc_type: 'prd', due_date: '2026-07-21', due_rule: 'Build start −2w', doc_status: 'overdue' });
    const results = tasks.find((t: any) => t.doc_key === 'experiment_brief.results');
    expect(results.doc_type).toBe('experiment_brief');
  });

  it('is idempotent', async () => {
    const p = await linkedModularProject();
    await apply({ project_id: p.id });
    const again = await apply({ project_id: p.id });
    expect(again.body.created).toEqual([]);
    expect(again.body.redated).toEqual([]);
  });

  it('re-dates tasks when roadmap dates move, and logs it', async () => {
    const p = await linkedModularProject();
    await apply({ project_id: p.id });
    await sync([modularItem({ phases: {
      discovery: { start: '2026-03-01', end: '2026-03-30' },
      build: { start: '2026-08-18', end: '2026-11-10' },
      measure: { start: '2026-11-10', end: '2026-12-01' },
    } })]);
    const res = await apply({ project_id: p.id });
    expect(res.body.redated).toEqual(expect.arrayContaining([
      expect.objectContaining({ doc_key: 'prd', from: '2026-07-21', to: '2026-08-04' }),
    ]));
    const log = await client.execute(`SELECT count(*) AS c FROM activity WHERE type='doc_due_changed'`);
    expect(Number((log.rows[0] as any).c)).toBeGreaterThan(0);
  });

  it('counts a published page with a done task as done', async () => {
    const p = await linkedModularProject();
    const res = await apply({ project_id: p.id, evidence: { prd: { page_url: 'https://minted.atlassian.net/wiki/spaces/PM/pages/4102684675/PRD', published: true } } });
    const prdTask = res.body.created.find((c: any) => c.doc_key === 'prd');
    await request(app).patch(`/api/projects/${p.id}/tasks/${prdTask.id}/status`).send({ status: 'done' });
    const health = await request(app).get(`/api/docs/health?project_id=${p.id}&today=${TODAY}`);
    const prd = health.body.projects[0].rows.find((r: any) => r.key === 'prd');
    expect(prd.status).toBe('done');
  });

  it('completes link-only tasks when the roadmap link is set', async () => {
    const p = await linkedModularProject({ links: { jiraEpic: 'https://minted.atlassian.net/browse/WW-1' } });
    const res = await apply({ project_id: p.id });
    expect(res.body.completed.map((c: any) => c.doc_key)).toContain('jira_epic');
    const tasks = (await request(app).get(`/api/projects/${p.id}/tasks`)).body;
    expect(tasks.find((t: any) => t.doc_key === 'jira_epic').status).toBe('done');
  });

  it('rejects untracked projects', async () => {
    const res = await apply({ project_id: 'general' });
    expect(res.status).toBe(400);
  });
});

describe('docs health', () => {
  it('filters and summarises', async () => {
    const p = await linkedModularProject();
    await apply({ project_id: p.id });
    const all = await request(app).get(`/api/docs/health?today=${TODAY}`);
    expect(all.body.projects.map((x: any) => x.project_id)).toEqual([p.id]);
    expect(all.body.summary.overdue).toBeGreaterThan(0);
    expect(all.body.projects[0]).toMatchObject({ team: 'WW', half: '2026-H2', roadmap_stage: 'build', docs_stage: 'roadmap' });
    expect(all.body.projects[0].flags).toContain('no_hub');
    expect((await request(app).get(`/api/docs/health?team=OI&today=${TODAY}`)).body.projects).toEqual([]);
    expect((await request(app).get(`/api/docs/health?half=2026-H1&today=${TODAY}`)).body.projects).toEqual([]);
    expect((await request(app).get(`/api/docs/health?status=overdue&today=${TODAY}`)).body.projects).toHaveLength(1);
    expect((await request(app).get(`/api/docs/health?status=done&today=${TODAY}`)).body.projects).toEqual([]);
  });
});

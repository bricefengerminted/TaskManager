import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../index';
import { client } from '../db';
import { linkedModularProject, modularItem, sync } from './helpers';

const TODAY = '2026-10-28';
const apply = (body: Record<string, unknown>) =>
  request(app).post('/api/docs/apply').set('X-Actor', 'claude').send({ today: TODAY, ...body });
const sql = async (q: string, args: any[] = []) => (await client.execute({ sql: q, args })).rows as any[];
const task = async (pid: string, key: string) =>
  (await sql(`SELECT * FROM tasks WHERE project_id=? AND doc_key=?`, [pid, key]))[0];
const count = async (q: string, args: any[] = []) => Number((await sql(q, args))[0].c);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('manual due dates', () => {
  it('preserves a user edit and reports a conflict', async () => {
    const p = await linkedModularProject();
    await apply({ project_id: p.id });
    expect((await task(p.id, 'prd')).due_computed).toBe('2026-07-21');
    await sql(`UPDATE tasks SET due_date='2026-12-25' WHERE project_id=? AND doc_key='prd'`, [p.id]);
    const res = await apply({ project_id: p.id });
    expect((await task(p.id, 'prd')).due_date).toBe('2026-12-25');
    expect(res.body.redated.map((r: any) => r.doc_key)).not.toContain('prd');
    expect(res.body.conflicts).toEqual([
      expect.objectContaining({ doc_key: 'prd', task_due: '2026-12-25', matrix_due: '2026-07-21', due_rule: 'Build start −2w' }),
    ]);
  });

  it('keeps a user edit when the roadmap moves, and logs the conflict once', async () => {
    const p = await linkedModularProject();
    await apply({ project_id: p.id });
    await sql(`UPDATE tasks SET due_date='2026-12-25' WHERE project_id=? AND doc_key='prd'`, [p.id]);
    await sync([modularItem({ phases: { build: { start: '2026-08-18', end: '2026-11-10' }, measure: { start: '2026-11-10', end: '2026-12-01' }, discovery: { start: '2026-03-01', end: '2026-03-30' } } })]);
    const res = await apply({ project_id: p.id });
    expect((await task(p.id, 'prd')).due_date).toBe('2026-12-25');
    expect((await task(p.id, 'prd')).due_computed).toBe('2026-08-04');
    expect(res.body.conflicts.map((c: any) => c.doc_key)).toContain('prd');
    expect(await count(`SELECT count(*) c FROM activity WHERE type='doc_due_conflict'`)).toBe(1);
    await apply({ project_id: p.id });
    expect(await count(`SELECT count(*) c FROM activity WHERE type='doc_due_conflict'`)).toBe(1);
  });

  it('re-dates an unedited task when the roadmap moves', async () => {
    const p = await linkedModularProject();
    await apply({ project_id: p.id });
    await sync([modularItem({ phases: { build: { start: '2026-08-18', end: '2026-11-10' } } })]);
    const res = await apply({ project_id: p.id });
    const prd = await task(p.id, 'prd');
    expect(prd.due_date).toBe('2026-08-04');
    expect(prd.due_computed).toBe('2026-08-04');
    expect(res.body.redated).toEqual(expect.arrayContaining([expect.objectContaining({ doc_key: 'prd', from: '2026-07-21', to: '2026-08-04' })]));
  });

  it('does not change a backfilled task with a different date, and lists it as a conflict', async () => {
    const p = await linkedModularProject();
    await sql(
      `INSERT INTO tasks (id, project_id, title, due_date, doc_key, created_at, updated_at) VALUES ('bf', ?, 'Write PRD', '2026-09-01', 'prd', 'x', 'x')`,
      [p.id],
    );
    const res = await apply({ project_id: p.id });
    const t = await task(p.id, 'prd');
    expect(t.due_date).toBe('2026-09-01');
    expect(t.due_computed).toBe('2026-07-21');
    expect(res.body.conflicts).toEqual([
      expect.objectContaining({ id: 'bf', doc_key: 'prd', task_due: '2026-09-01', matrix_due: '2026-07-21' }),
    ]);
    expect(await count(`SELECT count(*) c FROM activity WHERE type='doc_due_conflict'`)).toBe(1);
  });

  it('a null matrix due never nulls an existing date', async () => {
    const p = await linkedModularProject({ phases: {} });
    await sql(
      `INSERT INTO tasks (id, project_id, title, due_date, doc_key, created_at, updated_at) VALUES ('bf', ?, 'Write PRD', '2026-09-01', 'prd', 'x', 'x')`,
      [p.id],
    );
    const res = await apply({ project_id: p.id });
    expect((await task(p.id, 'prd')).due_date).toBe('2026-09-01');
    expect(res.body.redated).toEqual([]);
  });

  it('fills a missing due date when the matrix can now date it', async () => {
    const p = await linkedModularProject();
    await sql(
      `INSERT INTO tasks (id, project_id, title, due_date, doc_key, created_at, updated_at) VALUES ('bf', ?, 'Write PRD', NULL, 'prd', 'x', 'x')`,
      [p.id],
    );
    await apply({ project_id: p.id });
    expect((await task(p.id, 'prd')).due_date).toBe('2026-07-21');
  });
});

describe('dry run', () => {
  it('computes everything and writes nothing', async () => {
    const p = await linkedModularProject();
    const before = await count(`SELECT count(*) c FROM activity`);
    const res = await apply({ project_id: p.id, dry_run: true, evidence: { prd: { published: true } } });
    expect(res.status).toBe(200);
    expect(res.body.dry_run).toBe(true);
    expect(res.body.created).toHaveLength(8);
    expect(res.body.conflicts).toEqual([]);
    expect(await count(`SELECT count(*) c FROM tasks WHERE doc_key IS NOT NULL`)).toBe(0);
    expect(await count(`SELECT count(*) c FROM activity`)).toBe(before);
  });

  it('rejects a non-boolean dry_run', async () => {
    const p = await linkedModularProject();
    expect((await apply({ project_id: p.id, dry_run: 'yes' })).status).toBe(400);
  });
});

describe('evidence', () => {
  it('sets, replaces wholesale and clears; ignores non-required keys', async () => {
    const p = await linkedModularProject();
    const url = 'https://minted.atlassian.net/wiki/spaces/PM/pages/1/PRD';
    const res = await apply({ project_id: p.id, evidence: { prd: { page_url: url, published: true }, research: { published: true } } });
    expect(res.body.ignored_evidence).toEqual(['research']);
    expect(JSON.parse((await task(p.id, 'prd')).doc_evidence)).toEqual({ page_url: url, published: true });
    await apply({ project_id: p.id, evidence: { prd: { published: true } } });
    expect(JSON.parse((await task(p.id, 'prd')).doc_evidence)).toEqual({ published: true });
    await apply({ project_id: p.id, evidence: { prd: null } });
    expect((await task(p.id, 'prd')).doc_evidence).toBeNull();
  });
});

describe('idempotency', () => {
  it('a second apply leaves every task untouched', async () => {
    const p = await linkedModularProject();
    await apply({ project_id: p.id });
    const before = await sql(`SELECT id, updated_at, doc_status, due_date FROM tasks WHERE project_id=? ORDER BY id`, [p.id]);
    await sleep(5);
    await apply({ project_id: p.id });
    expect(await sql(`SELECT id, updated_at, doc_status, due_date FROM tasks WHERE project_id=? ORDER BY id`, [p.id])).toEqual(before);
  });

  it('doc tasks whose key is not required get a null doc_status', async () => {
    const p = await linkedModularProject();
    await sql(
      `INSERT INTO tasks (id, project_id, title, doc_key, doc_status, created_at, updated_at) VALUES ('r', ?, 'Research', 'research', 'waived', 'x', 'x')`,
      [p.id],
    );
    await apply({ project_id: p.id });
    expect((await task(p.id, 'research')).doc_status).toBeNull();
  });
});

describe('link-only rows and the audit trail', () => {
  it('creates an already-linked link-only task as done with one log row', async () => {
    const p = await linkedModularProject({ links: { jiraEpic: 'https://minted.atlassian.net/browse/WW-1' } });
    const res = await apply({ project_id: p.id });
    const t = await task(p.id, 'jira_epic');
    expect(t.status).toBe('done');
    expect(res.body.completed.map((c: any) => c.doc_key)).toContain('jira_epic');
    expect(await count(`SELECT count(*) c FROM activity WHERE task_id=?`, [t.id])).toBe(1);
  });

  it('completion bumps updated_at', async () => {
    const p = await linkedModularProject();
    await apply({ project_id: p.id });
    const before = (await task(p.id, 'jira_epic')).updated_at;
    await sleep(5);
    await sync([modularItem({ links: { jiraEpic: 'https://minted.atlassian.net/browse/WW-1' } })]);
    await apply({ project_id: p.id });
    const t = await task(p.id, 'jira_epic');
    expect(t.status).toBe('done');
    expect(t.updated_at).not.toBe(before);
  });

  it('writes one docs_applied summary per real apply', async () => {
    const p = await linkedModularProject();
    await apply({ project_id: p.id, dry_run: true });
    expect(await count(`SELECT count(*) c FROM activity WHERE type='docs_applied'`)).toBe(0);
    await apply({ project_id: p.id, evidence: { prd: { published: true } } });
    const rows = await sql(`SELECT detail FROM activity WHERE type='docs_applied'`);
    expect(rows).toHaveLength(1);
    const d = JSON.parse(rows[0].detail);
    expect(d.created).toBe(8);
    expect(d.evidence_keys).toEqual(['prd']);
  });
});

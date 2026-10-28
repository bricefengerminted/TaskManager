import { describe, it, expect } from 'vitest';
import { client } from '../db';
import { runMigrations } from '../db/migrate';

const ts = '2026-10-28T00:00:00.000Z';

async function addTask(id: string, projectId: string, title: string) {
  await client.execute({
    sql: `INSERT INTO tasks (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    args: [id, projectId, title, ts, ts],
  });
}

describe('migrations', () => {
  it('adds doc-system columns and tables idempotently', async () => {
    await runMigrations();
    const pcols = (await client.execute(`PRAGMA table_info(projects)`)).rows.map((r: any) => r.name);
    expect(pcols).toEqual(expect.arrayContaining([
      'roadmap_item_id', 'team', 'docs_stage', 'decision', 'decision_date', 'decision_reason',
      'revisit_by', 'doc_mode', 'customer_facing', 'waivers', 'hub_url', 'one_pager_url',
    ]));
    const tcols = (await client.execute(`PRAGMA table_info(tasks)`)).rows.map((r: any) => r.name);
    expect(tcols).toEqual(expect.arrayContaining(['doc_key', 'doc_status', 'due_rule', 'doc_evidence']));
    const tables = (await client.execute(`SELECT name FROM sqlite_master WHERE type='table'`)).rows.map((r: any) => r.name);
    expect(tables).toEqual(expect.arrayContaining(['roadmap_items', 'activity']));
  });

  it('backfills doc_key from lifecycle task titles, one per project', async () => {
    await client.execute({
      sql: `INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1', '[IDEA-932] Header', ?, ?)`,
      args: [ts, ts],
    });
    await addTask('t1', 'p1', 'Write PRD');
    await addTask('t2', 'p1', 'Final results readout');
    await addTask('t3', 'p1', '2-week metrics check');
    await addTask('t4', 'p1', '2-week metrics check');
    await runMigrations();
    const rows = (await client.execute(`SELECT id, doc_key FROM tasks WHERE project_id='p1' ORDER BY id`)).rows as any[];
    const keys = Object.fromEntries(rows.map((r) => [r.id, r.doc_key]));
    expect(keys.t1).toBe('prd');
    expect(keys.t2).toBe('experiment_brief.results');
    expect([keys.t3, keys.t4].filter((k) => k === 'metrics_snapshot')).toHaveLength(1);
  });

  it('rejects a second task with the same doc_key in a project', async () => {
    await client.execute({
      sql: `INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p2', 'X', ?, ?)`,
      args: [ts, ts],
    });
    await client.execute({
      sql: `INSERT INTO tasks (id, project_id, title, doc_key, created_at, updated_at) VALUES ('a', 'p2', 'A', 'prd', ?, ?)`,
      args: [ts, ts],
    });
    await expect(client.execute({
      sql: `INSERT INTO tasks (id, project_id, title, doc_key, created_at, updated_at) VALUES ('b', 'p2', 'B', 'prd', ?, ?)`,
      args: [ts, ts],
    })).rejects.toThrow();
  });
});

import { beforeEach } from 'vitest';
import { runMigrations } from '../db/migrate';
import { client } from '../db';

beforeEach(async () => {
  await runMigrations();
  const tbls = await client.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
  );
  for (const r of tbls.rows) {
    await client.execute(`DELETE FROM ${(r as any).name}`);
  }
  const ts = new Date().toISOString();
  await client.execute({
    sql: `INSERT OR IGNORE INTO projects (id,name,description,status,created_at,updated_at) VALUES ('general','General','','active',?,?)`,
    args: [ts, ts],
  });
});

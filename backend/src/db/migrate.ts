import { client } from './index';

// Create tables if they don't exist (simple migration approach without drizzle-kit push)
export async function runMigrations() {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'in_progress', 'done')),
      priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
      due_date TEXT,
      source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual', 'slack')),
      slack_raw TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Add columns if they don't exist (safe to run repeatedly)
  const cols = await client.execute(`PRAGMA table_info(tasks)`);
  const colNames = new Set(cols.rows.map((r: any) => r.name));

  if (!colNames.has('images')) {
    await client.execute(`ALTER TABLE tasks ADD COLUMN images TEXT NOT NULL DEFAULT '[]'`);
  }
  if (!colNames.has('position')) {
    await client.execute(`ALTER TABLE tasks ADD COLUMN position INTEGER NOT NULL DEFAULT 0`);
  }

  // Ensure "General" project always exists
  const ts = new Date().toISOString();
  await client.execute({
    sql: `INSERT OR IGNORE INTO projects (id, name, description, status, created_at, updated_at)
          VALUES ('general', 'General', 'Default project for quick task capture', 'active', ?, ?)`,
    args: [ts, ts],
  });

  console.log('Migrations complete.');
}

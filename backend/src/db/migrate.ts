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
  if (!colNames.has('links')) {
    await client.execute(`ALTER TABLE tasks ADD COLUMN links TEXT NOT NULL DEFAULT '[]'`);
  }
  if (!colNames.has('doc_type')) {
    await client.execute(`ALTER TABLE tasks ADD COLUMN doc_type TEXT`);
  }

  for (const name of ['doc_key', 'doc_status', 'due_rule', 'doc_evidence', 'due_computed']) {
    if (!colNames.has(name)) {
      await client.execute(`ALTER TABLE tasks ADD COLUMN ${name} TEXT`);
    }
  }

  if (!colNames.has('due_pinned')) {
    await client.execute(`ALTER TABLE tasks ADD COLUMN due_pinned INTEGER NOT NULL DEFAULT 0`);
  }

  const pcols = await client.execute(`PRAGMA table_info(projects)`);
  const pcolNames = new Set(pcols.rows.map((r: any) => r.name));
  const projectCols: [string, string][] = [
    ['roadmap_item_id', 'TEXT'],
    ['team', 'TEXT'],
    ['docs_stage', 'TEXT'],
    ['decision', 'TEXT'],
    ['decision_date', 'TEXT'],
    ['decision_reason', 'TEXT'],
    ['revisit_by', 'TEXT'],
    ['doc_mode', "TEXT NOT NULL DEFAULT 'full'"],
    ['customer_facing', 'INTEGER NOT NULL DEFAULT 0'],
    ['waivers', "TEXT NOT NULL DEFAULT '{}'"],
    ['hub_url', 'TEXT'],
    ['one_pager_url', 'TEXT'],
  ];
  for (const [name, ddl] of projectCols) {
    if (!pcolNames.has(name)) {
      await client.execute(`ALTER TABLE projects ADD COLUMN ${name} ${ddl}`);
    }
  }

  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS roadmap_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      team_id TEXT, team_name TEXT, parent_team_id TEXT,
      stage TEXT NOT NULL, status TEXT, pm_name TEXT, jira_key TEXT,
      phases TEXT NOT NULL DEFAULT '{}',
      dev_start_half TEXT,
      links TEXT NOT NULL DEFAULT '{}',
      hidden INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT,
      first_seen_at TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, actor TEXT NOT NULL DEFAULT 'user',
      type TEXT NOT NULL, task_id TEXT, project_id TEXT, task_title TEXT,
      summary TEXT NOT NULL, detail TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at);
  `);

  // Backfill doc_key on existing lifecycle tasks (one task per project per key).
  // Titles are normalised: leading "[Phase] " and one trailing "(note)" are stripped.
  const TITLE_TO_DOC_KEY: Record<string, string> = {
    'write prd': 'prd',
    'create experimentation doc': 'experiment_brief.plan',
    'write release notes': 'release_notes',
    '2-week metrics check': 'metrics_snapshot',
    'final results readout': 'experiment_brief.results',
  };
  const normTitle = (t: string) =>
    t.replace(/^\s*\[[^\]]*\]\s*/, '').replace(/\s*\([^()]*\)\s*$/, '').trim().toLowerCase();

  const unkeyed = (await client.execute(
    `SELECT id, project_id, title FROM tasks WHERE doc_key IS NULL ORDER BY created_at, id`
  )).rows as any[];
  const keyed = (await client.execute(
    `SELECT project_id, doc_key FROM tasks WHERE doc_key IS NOT NULL`
  )).rows as any[];
  const taken = new Map<string, Set<string>>();
  for (const r of keyed) {
    if (!taken.has(r.project_id)) taken.set(r.project_id, new Set());
    taken.get(r.project_id)!.add(r.doc_key);
  }
  for (const t of unkeyed) {
    const key = TITLE_TO_DOC_KEY[normTitle(String(t.title))];
    if (!key) continue;
    const set = taken.get(t.project_id) ?? new Set<string>();
    taken.set(t.project_id, set);
    if (set.has(key)) continue;
    await client.execute({ sql: `UPDATE tasks SET doc_key = ?, doc_type = ? WHERE id = ?`, args: [key, key.split('.')[0], t.id] });
    set.add(key);
  }

  // Idempotent fix-up: doc_type is the doc_key's prefix (experiment_brief.plan -> experiment_brief).
  await client.execute(
    `UPDATE tasks SET doc_type = CASE WHEN instr(doc_key, '.') > 0 THEN substr(doc_key, 1, instr(doc_key, '.') - 1) ELSE doc_key END
     WHERE doc_key IS NOT NULL AND (doc_type IS NULL OR doc_type != CASE WHEN instr(doc_key, '.') > 0 THEN substr(doc_key, 1, instr(doc_key, '.') - 1) ELSE doc_key END)`
  );

  await client.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_project_doc_key ON tasks(project_id, doc_key) WHERE doc_key IS NOT NULL`
  );

  // Ensure "General" project always exists
  const ts = new Date().toISOString();
  await client.execute({
    sql: `INSERT OR IGNORE INTO projects (id, name, description, status, created_at, updated_at)
          VALUES ('general', 'General', 'Default project for quick task capture', 'active', ?, ?)`,
    args: [ts, ts],
  });

  console.log('Migrations complete.');
}

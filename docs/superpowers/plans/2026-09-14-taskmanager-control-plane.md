# TaskManager Control Plane — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers-extended-cc:subagent-driven-development (if subagents available) or superpowers-extended-cc:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn TaskManager into the human control plane for the daily-briefing routine — an Inbox where everything the routine generates is approved/edited/declined, a live "Today" cockpit that replaces the dead markdown briefing, a roadmap reconciliation view over the Jira IDEA board, and an Outbox of approved changes the routine pushes back out.

**Architecture:** The Express backend stores intents and state only — it never calls Jira/Confluence/JPD. Claude (the scheduled routine, or on-demand via MCP) is the sole actuator in both directions: it reads the world and *proposes* into the Inbox, and it drains the *Outbox* to write back. New backend routes (proposals, activity, briefing, upcoming, roadmap, outbox) follow the existing Express + Drizzle + libsql patterns; the frontend adds Cockpit/Inbox/Roadmap/Outbox surfaces to the existing React + Router + Tailwind app; the MCP server gains propose/roadmap/outbox tools.

**Tech Stack:** Node + Express + Drizzle ORM + libsql (SQLite), React 19 + React Router 7 + Tailwind 3 + `@hello-pangea/dnd`, `@modelcontextprotocol/sdk`. Tests: Vitest + supertest (added in Task 1).

**Spec:** `docs/superpowers/specs/2026-09-14-taskmanager-control-plane-design.md`

---

## Cross-Cutting Reconciliation Notes (READ FIRST)

These override the individual task snippets wherever they conflict; they exist because the three phases were drafted against a shared contract and touch a few of the same files.

1. **`backend/src/db/index.ts` Drizzle registration is cumulative.** By the end of the plan it must be exactly:
   ```ts
   import { projects, tasks, proposals, activity, briefings, roadmapItems, outbox } from './schema';
   export const db = drizzle(client, { schema: { projects, tasks, proposals, activity, briefings, roadmapItems, outbox } });
   ```
   Task 2 adds `proposals, activity, briefings`; Task 12 adds `roadmapItems`; Task 16 adds `outbox`. Never remove tables already registered — only add.

2. **`shared/types.ts` is append-only across phases.** Task 2 appends the Phase 1 block, Task 12 the Phase 2 block, Task 16 the Phase 3 block. The one exception: Task 16 also edits the three Phase 1 payload interfaces to add an optional `outbox?: EnqueueOutboxInput[]` field (TypeScript resolves the forward type reference within the module).

3. **`logActivity` takes `type:`, never `event:`.** Signature is `logActivity({ actor, type, task_id?, project_id?, task_title?, summary, detail? })`. All call sites (including Phase 3's outbox route) use `type`.

4. **`backend/src/db/migrate.ts` DDL is additive** — each phase appends its `CREATE TABLE IF NOT EXISTS` blocks inside the existing `client.executeMultiple(...)` template. `backend/src/test/setup.ts` clears *all existing tables* generically (see Task 1), so later tables need no setup edits.

5. **Sidebar nav.** Task 8 replaces the top nav block with a `Today / Inbox / Dashboard` group inside one `<div className="px-3 mb-2 space-y-1">`. Task 15 (Roadmap) and Task 19 (Outbox) add their `<Link>`s **inside that same group**, after the Dashboard link — not against the original pre-Task-8 markup.

6. **Execution order matters for frontend builds.** Task 8's Cockpit imports `Inbox` (Task 9), and `App.tsx` grows routes for Roadmap (Task 15) and Outbox (Task 19). Build/verify a frontend task after the tasks it imports exist; if building Task 8 in isolation, stub `Inbox` (Task 9 replaces it).

---

## File Structure

**Backend (new):** `src/lib/actor.ts`, `src/lib/activity.ts`, `src/routes/activity.ts`, `src/routes/proposals.ts`, `src/routes/briefing.ts`, `src/routes/upcoming.ts`, `src/routes/roadmap.ts`, `src/routes/outbox.ts`, `src/scripts/import-roadmap.ts`, `vitest.config.ts`, `src/test/setup.ts`.
**Backend (modified):** `src/db/schema.ts`, `src/db/index.ts`, `src/db/migrate.ts`, `src/routes/tasks.ts`, `src/index.ts`, `package.json`.
**Shared (modified):** `shared/types.ts`.
**Frontend (new):** `src/components/cockpit/Cockpit.tsx`, `src/components/inbox/Inbox.tsx`, `src/components/roadmap/Roadmap.tsx`, `src/components/outbox/OutboxPanel.tsx`.
**Frontend (modified):** `src/api/client.ts`, `src/context/AppContext.tsx`, `src/App.tsx`, `src/components/layout/Sidebar.tsx`.
**MCP (modified):** `mcp-server/src/index.ts`.
**Routines (modified, outside app repo — not committed):** `~/.claude/scheduled-tasks/{daily-morning-briefing,monday-weekly-planning,friday-weekly-review-prep}/SKILL.md`.

---

# Phase 1 — Inbox + Live Cockpit + Activity Log

Tasks 1–11. Each task is one commit; TDD where the task has backend logic.

### Task 1: Backend test harness (Vitest + supertest)

**Goal:** Stand up a Vitest + supertest harness that boots the Express app against a throwaway SQLite DB with per-test table clearing, so every later backend task is TDD-able.

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/src/index.ts`
- Create: `backend/vitest.config.ts`
- Create: `backend/src/test/setup.ts`
- Create: `backend/.gitignore`
- Test: `backend/src/test/sanity.test.ts`

**Acceptance Criteria:**
- [ ] `npm --prefix backend test` runs Vitest and the sanity test passes.
- [ ] Importing the app in a test does NOT bind a TCP port (guarded `app.listen`).
- [ ] `test-taskmanager.db` is git-ignored.

**Verify:** `npm --prefix backend test` → exit 0, `2 passed`.

**Steps:**

- [ ] **Step 1: Add deps and scripts to `backend/package.json`** — add scripts `"test": "vitest run"` and `"test:watch": "vitest"`, and devDependencies `"vitest": "^1.6.0"`, `"supertest": "^6.3.4"`, `"@types/supertest": "^6.0.2"`.

- [ ] **Step 2: Guard `app.listen` in `backend/src/index.ts`** — replace the bottom `app.listen(...)` block with:
```ts
if (process.env.NODE_ENV !== 'test' && process.env.VITEST === undefined) {
  app.listen(PORT, () => {
    console.log(`TaskManager API running on http://localhost:${PORT}`);
  });
}
```
(Keep `export default app;` as the last line.)

- [ ] **Step 3: Create `backend/vitest.config.ts`**
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: { DB_PATH: './test-taskmanager.db' },
    fileParallelism: false,
    setupFiles: ['./src/test/setup.ts'],
  },
});
```

- [ ] **Step 4: Create `backend/src/test/setup.ts`**
```ts
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
```

- [ ] **Step 5: Create `backend/.gitignore`**
```gitignore
test-taskmanager.db
test-taskmanager.db-shm
test-taskmanager.db-wal
```

- [ ] **Step 6: Create `backend/src/test/sanity.test.ts`**
```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../index';

describe('harness', () => {
  it('serves the health endpoint', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('seeds the General project', async () => {
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.body.some((p: any) => p.id === 'general')).toBe(true);
  });
});
```

- [ ] **Step 7: Install, run verification and commit**
Run: `npm --prefix backend install && npm --prefix backend test` → Expected: `2 passed`.
```bash
git add backend/package.json backend/package-lock.json backend/vitest.config.ts backend/src/test/setup.ts backend/src/index.ts backend/.gitignore backend/src/test/sanity.test.ts
git commit -m "test(backend): add vitest+supertest harness with listen guard"
```

---

### Task 2: Data model (proposals, activity, briefings) + shared types

**Goal:** Add the three new tables to the drizzle schema, register them, add idempotent DDL to the migration, and add the Phase 1 shared TypeScript types.

**Files:**
- Modify: `backend/src/db/schema.ts`
- Modify: `backend/src/db/index.ts`
- Modify: `backend/src/db/migrate.ts`
- Modify: `shared/types.ts`
- Create: `backend/src/db/migrate-test-exports.ts`
- Test: `backend/src/test/migrate.test.ts`

**Acceptance Criteria:**
- [ ] After `runMigrations()`, `proposals`, `activity`, and `briefings` tables exist.
- [ ] The three drizzle tables are registered in the drizzle client schema.
- [ ] The `idx_proposals_dedupe` unique index exists.

**Verify:** `npm --prefix backend test src/test/migrate.test.ts` → `2 passed`.

**Steps:**

- [ ] **Step 1: Write the migration test `backend/src/test/migrate.test.ts`**
```ts
import { describe, it, expect } from 'vitest';
import { runMigrations, client } from '../db/migrate-test-exports';

describe('migrations', () => {
  it('creates the phase-1 tables', async () => {
    await runMigrations();
    const r = await client.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('proposals','activity','briefings')`
    );
    expect(r.rows.map((x: any) => x.name).sort()).toEqual(['activity', 'briefings', 'proposals']);
  });

  it('creates the dedupe unique index on proposals', async () => {
    await runMigrations();
    const r = await client.execute(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_proposals_dedupe'`
    );
    expect(r.rows.length).toBe(1);
  });
});
```

- [ ] **Step 2: Create the test re-export shim `backend/src/db/migrate-test-exports.ts`**
```ts
export { runMigrations } from './migrate';
export { client } from './index';
```

- [ ] **Step 3: Add drizzle table defs to `backend/src/db/schema.ts`** (append after the existing `tasks` table, before the `export type` lines)
```ts
export const proposals = sqliteTable('proposals', {
  id: text('id').primaryKey(),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
  kind: text('kind').notNull(),
  status: text('status').notNull().default('pending'),
  source: text('source').notNull(),
  actor: text('actor').notNull().default('claude'),
  dedupe_key: text('dedupe_key'),
  title: text('title').notNull(),
  rationale: text('rationale').notNull().default(''),
  target_project_id: text('target_project_id'),
  target_task_id: text('target_task_id'),
  payload: text('payload').notNull().default('{}'),
  confidence: text('confidence'),
  result_task_id: text('result_task_id'),
  result_project_id: text('result_project_id'),
  decided_at: text('decided_at'),
});

export const activity = sqliteTable('activity', {
  id: text('id').primaryKey(),
  created_at: text('created_at').notNull(),
  actor: text('actor').notNull().default('user'),
  type: text('type').notNull(),
  task_id: text('task_id'),
  project_id: text('project_id'),
  task_title: text('task_title'),
  summary: text('summary').notNull(),
  detail: text('detail'),
});

export const briefings = sqliteTable('briefings', {
  date: text('date').primaryKey(),
  sections: text('sections').notNull().default('{}'),
  created_at: text('created_at').notNull(),
});

export type ProposalRow = typeof proposals.$inferSelect;
export type ActivityRow = typeof activity.$inferSelect;
export type BriefingRow = typeof briefings.$inferSelect;
```

- [ ] **Step 4: Register the tables in `backend/src/db/index.ts`**
```ts
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { projects, tasks, proposals, activity, briefings } from './schema';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../taskmanager.db');

const client = createClient({ url: `file:${DB_PATH}` });

export const db = drizzle(client, { schema: { projects, tasks, proposals, activity, briefings } });
export { client };
```

- [ ] **Step 5: Add DDL to `backend/src/db/migrate.ts`** (append the new SQL inside the existing `client.executeMultiple(` template string, right before the closing `` `); ``)
```sql
    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', source TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT 'claude', dedupe_key TEXT,
      title TEXT NOT NULL, rationale TEXT NOT NULL DEFAULT '',
      target_project_id TEXT, target_task_id TEXT,
      payload TEXT NOT NULL DEFAULT '{}', confidence TEXT,
      result_task_id TEXT, result_project_id TEXT, decided_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_proposals_dedupe ON proposals(dedupe_key) WHERE dedupe_key IS NOT NULL;

    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, actor TEXT NOT NULL DEFAULT 'user',
      type TEXT NOT NULL, task_id TEXT, project_id TEXT, task_title TEXT,
      summary TEXT NOT NULL, detail TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at);

    CREATE TABLE IF NOT EXISTS briefings (
      date TEXT PRIMARY KEY, sections TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
    );
```

- [ ] **Step 6: Add Phase 1 types to `shared/types.ts`** (append at end of file)
```ts
// ── Phase 1: control-plane types ──────────────────────────────────
export type Actor = 'claude' | 'user';
export type ProposalKind = 'create_task' | 'update_task' | 'create_project';
export type ProposalStatus = 'pending' | 'approved' | 'declined' | 'applied' | 'superseded';
export type ProposalSource = 'meeting_notes' | 'slack' | 'jira_timeline' | 'roadmap_gap' | 'manual';
export type Confidence = 'low' | 'medium' | 'high';

export interface CreateTaskPayload {
  project_id: string; title: string; description?: string;
  priority?: TaskPriority; due_date?: string | null; status?: TaskStatus;
  links?: TaskLink[]; doc_type?: string | null;
}
export interface UpdateTaskPayload {
  title?: string; description?: string; status?: TaskStatus;
  priority?: TaskPriority; due_date?: string | null; links?: TaskLink[]; doc_type?: string | null;
}
export interface CreateProjectPayload {
  name: string; description?: string; idea_key?: string | null; tasks: CreateTaskPayload[];
}
export type ProposalPayload = CreateTaskPayload | UpdateTaskPayload | CreateProjectPayload;

export interface Proposal {
  id: string; created_at: string; updated_at: string;
  kind: ProposalKind; status: ProposalStatus; source: ProposalSource; actor: Actor;
  dedupe_key: string | null; title: string; rationale: string;
  target_project_id: string | null; target_task_id: string | null;
  payload: ProposalPayload; confidence: Confidence | null;
  result_task_id: string | null; result_project_id: string | null; decided_at: string | null;
}
export interface CreateProposalInput {
  kind: ProposalKind; source: ProposalSource; title: string; rationale?: string;
  dedupe_key?: string | null; target_project_id?: string | null; target_task_id?: string | null;
  payload: ProposalPayload; confidence?: Confidence | null;
}
export interface ActivityEntry {
  id: string; created_at: string; actor: Actor; type: string;
  task_id: string | null; project_id: string | null; task_title: string | null;
  summary: string; detail: Record<string, unknown> | null;
}
export interface BriefingSections {
  catch_up?: string[]; must_do?: string[]; should_do?: string[];
  if_time?: string[]; stakeholder_updates?: string[]; data_gaps?: string[];
}
export interface Briefing { date: string; sections: BriefingSections; created_at: string | null; }
export interface UpcomingTask extends Task { project_name: string; idea_key?: string | null; }
```

- [ ] **Step 7: Run verification and commit**
Run: `npm --prefix backend test src/test/migrate.test.ts` → Expected: `2 passed`.
```bash
git add backend/src/db/schema.ts backend/src/db/index.ts backend/src/db/migrate.ts backend/src/db/migrate-test-exports.ts shared/types.ts backend/src/test/migrate.test.ts
git commit -m "feat(db): add proposals/activity/briefings tables + phase-1 shared types"
```

---

### Task 3: Activity infrastructure + wire into task mutations

**Goal:** Add `actorOf`/`logActivity` helpers and a `GET /api/activity` route, and emit activity events from every task mutation with the PUT diff logic.

**Files:**
- Create: `backend/src/lib/actor.ts`
- Create: `backend/src/lib/activity.ts`
- Create: `backend/src/routes/activity.ts`
- Modify: `backend/src/routes/tasks.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/src/test/activity.test.ts`

**Acceptance Criteria:**
- [ ] POST task logs `task_created`; PATCH status→done logs `task_completed`; PUT that grows links logs `link_added`; PUT other field logs `task_updated`; DELETE logs `task_deleted`.
- [ ] `GET /api/activity` returns newest-first with parsed `detail`.
- [ ] `X-TM-Actor: claude` header sets `actor='claude'`; absence → `user`.

**Verify:** `npm --prefix backend test src/test/activity.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write tests `backend/src/test/activity.test.ts`**
```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../index';

async function makeTask(body: any = {}) {
  const res = await request(app)
    .post('/api/projects/general/tasks')
    .send({ title: 'T', ...body });
  return res.body;
}

describe('activity logging', () => {
  it('logs task_created on POST with actor from header', async () => {
    await request(app)
      .post('/api/projects/general/tasks')
      .set('X-TM-Actor', 'claude')
      .send({ title: 'From Claude' });
    const res = await request(app).get('/api/activity');
    expect(res.status).toBe(200);
    const created = res.body.find((a: any) => a.type === 'task_created');
    expect(created).toBeTruthy();
    expect(created.actor).toBe('claude');
    expect(created.task_title).toBe('From Claude');
  });

  it('defaults actor to user without the header', async () => {
    await makeTask({ title: 'From UI' });
    const res = await request(app).get('/api/activity');
    const created = res.body.find((a: any) => a.task_title === 'From UI');
    expect(created.actor).toBe('user');
  });

  it('logs task_completed on PATCH status done and status_changed otherwise', async () => {
    const t = await makeTask();
    await request(app).patch(`/api/projects/general/tasks/${t.id}/status`).send({ status: 'in_progress' });
    await request(app).patch(`/api/projects/general/tasks/${t.id}/status`).send({ status: 'done' });
    const res = await request(app).get('/api/activity');
    expect(res.body.some((a: any) => a.type === 'status_changed' && a.task_id === t.id)).toBe(true);
    expect(res.body.some((a: any) => a.type === 'task_completed' && a.task_id === t.id)).toBe(true);
  });

  it('logs link_added when PUT grows the links array, else task_updated', async () => {
    const t = await makeTask();
    await request(app).put(`/api/projects/general/tasks/${t.id}`)
      .send({ links: [{ type: 'jira', label: 'X', url: 'http://x' }] });
    await request(app).put(`/api/projects/general/tasks/${t.id}`).send({ description: 'new desc' });
    const res = await request(app).get('/api/activity');
    expect(res.body.some((a: any) => a.type === 'link_added' && a.task_id === t.id)).toBe(true);
    expect(res.body.some((a: any) => a.type === 'task_updated' && a.task_id === t.id)).toBe(true);
  });

  it('logs task_deleted on DELETE with the snapshotted title', async () => {
    const t = await makeTask({ title: 'Doomed' });
    await request(app).delete(`/api/projects/general/tasks/${t.id}`);
    const res = await request(app).get('/api/activity');
    const del = res.body.find((a: any) => a.type === 'task_deleted');
    expect(del.task_title).toBe('Doomed');
  });

  it('returns activity newest-first', async () => {
    await makeTask({ title: 'first' });
    await makeTask({ title: 'second' });
    const res = await request(app).get('/api/activity?limit=5');
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    expect(res.body[0].created_at >= res.body[1].created_at).toBe(true);
  });
});
```

- [ ] **Step 2: Create `backend/src/lib/actor.ts`**
```ts
import { Request } from 'express';
export type Actor = 'claude' | 'user';
export function actorOf(req: Request): Actor {
  return req.header('X-TM-Actor') === 'claude' ? 'claude' : 'user';
}
```

- [ ] **Step 3: Create `backend/src/lib/activity.ts`**
```ts
import { db } from '../db';
import { activity } from '../db/schema';
import { v4 as uuidv4 } from 'uuid';
import type { Actor } from './actor';

export async function logActivity(entry: {
  actor: Actor; type: string; task_id?: string | null; project_id?: string | null;
  task_title?: string | null; summary: string; detail?: unknown;
}): Promise<void> {
  try {
    await db.insert(activity).values({
      id: uuidv4(), created_at: new Date().toISOString(),
      actor: entry.actor, type: entry.type,
      task_id: entry.task_id ?? null, project_id: entry.project_id ?? null,
      task_title: entry.task_title ?? null, summary: entry.summary,
      detail: entry.detail != null ? JSON.stringify(entry.detail) : null,
    }).run();
  } catch (e) {
    console.error('logActivity failed:', (e as Error).message);
  }
}
```

- [ ] **Step 4: Create `backend/src/routes/activity.ts`**
```ts
import { Router, Request, Response } from 'express';
import { desc } from 'drizzle-orm';
import { db } from '../db';
import { activity } from '../db/schema';

const router = Router();

// GET /api/activity?limit=50
router.get('/', async (req: Request, res: Response) => {
  const raw = parseInt(String(req.query.limit ?? '50'), 10);
  const limit = Math.min(Number.isNaN(raw) ? 50 : raw, 500);
  const rows = await db.select().from(activity).orderBy(desc(activity.created_at)).limit(limit).all();
  res.json(rows.map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null })));
});

export default router;
```

- [ ] **Step 5: Replace `backend/src/routes/tasks.ts` with the activity-wired version** (adds `actorOf`/`logActivity` imports and logging calls to POST, PUT with old→new diff, DELETE, and PATCH status; the GET/reorder handlers are unchanged from the current file)
```ts
import { Router, Request, Response } from 'express';
import { eq, and, sql, asc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import { tasks, projects } from '../db/schema';
import { actorOf } from '../lib/actor';
import { logActivity } from '../lib/activity';
import type { CreateTaskInput, UpdateTaskInput } from '../../../shared/types';

const router = Router({ mergeParams: true });

function now() {
  return new Date().toISOString();
}

function parseTaskRow(row: any) {
  if (!row) return row;
  return {
    ...row,
    images: JSON.parse(row.images || '[]'),
    links: JSON.parse(row.links || '[]'),
  };
}

// GET /api/projects/:projectId/tasks
router.get('/', async (req: Request, res: Response) => {
  const project = await db.select().from(projects).where(eq(projects.id, req.params.projectId)).get();
  if (!project) return res.status(404).json({ error: 'Project not found' });

  let rows = await db.select().from(tasks)
    .where(eq(tasks.project_id, req.params.projectId))
    .orderBy(asc(tasks.position))
    .all();

  const docTypeFilter = req.query.doc_type;
  if (typeof docTypeFilter === 'string' && docTypeFilter.length > 0) {
    rows = rows.filter((r) => r.doc_type === docTypeFilter);
  }
  const dueWithin = req.query.due_within_days;
  if (dueWithin !== undefined) {
    const n = parseInt(String(dueWithin), 10);
    if (!Number.isNaN(n)) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + n);
      const cutoffStr = cutoff.toISOString().split('T')[0];
      rows = rows.filter((r) => r.due_date != null && r.due_date <= cutoffStr);
    }
  }

  return res.json(rows.map(parseTaskRow));
});

// POST /api/projects/:projectId/tasks
router.post('/', async (req: Request, res: Response) => {
  const project = await db.select().from(projects).where(eq(projects.id, req.params.projectId)).get();
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const {
    title, description = '', status = 'todo', priority = 'medium',
    due_date = null, source = 'manual', slack_raw = null, links = [], doc_type = null,
  }: CreateTaskInput = req.body;

  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });

  await db.update(tasks)
    .set({ position: sql`${tasks.position} + 1` })
    .where(and(eq(tasks.project_id, req.params.projectId), eq(tasks.status, status as any)))
    .run();

  const id = uuidv4();
  const ts = now();
  const task = {
    id, project_id: req.params.projectId, title: title.trim(), description,
    status: status as 'todo' | 'in_progress' | 'done',
    priority: priority as 'low' | 'medium' | 'high' | 'urgent',
    due_date: due_date ?? null, position: 0, images: '[]',
    links: JSON.stringify(links ?? []), doc_type: doc_type ?? null,
    source: source as 'manual' | 'slack', slack_raw: slack_raw ?? null,
    created_at: ts, updated_at: ts,
  };
  await db.insert(tasks).values(task).run();
  await logActivity({
    actor: actorOf(req), type: 'task_created', task_id: id,
    project_id: req.params.projectId, task_title: task.title,
    summary: `Created task "${task.title}"`,
  });
  return res.status(201).json(parseTaskRow(task));
});

// PATCH /api/projects/:projectId/tasks/reorder
router.patch('/reorder', async (req: Request, res: Response) => {
  const { columns } = req.body as { columns: Record<string, string[]> };
  if (!columns) return res.status(400).json({ error: 'columns is required' });

  const ts = now();
  for (const [status, taskIds] of Object.entries(columns)) {
    for (let i = 0; i < taskIds.length; i++) {
      await db.update(tasks)
        .set({ status: status as any, position: i, updated_at: ts })
        .where(and(eq(tasks.id, taskIds[i]), eq(tasks.project_id, req.params.projectId)))
        .run();
    }
  }

  const rows = await db.select().from(tasks)
    .where(eq(tasks.project_id, req.params.projectId))
    .orderBy(asc(tasks.position))
    .all();
  return res.json(rows.map(parseTaskRow));
});

// GET /api/projects/:projectId/tasks/:taskId
router.get('/:taskId', async (req: Request, res: Response) => {
  const task = await db.select().from(tasks)
    .where(and(eq(tasks.id, req.params.taskId), eq(tasks.project_id, req.params.projectId))).get();
  if (!task) return res.status(404).json({ error: 'Task not found' });
  return res.json(parseTaskRow(task));
});

// PUT /api/projects/:projectId/tasks/:taskId
router.put('/:taskId', async (req: Request, res: Response) => {
  const task = await db.select().from(tasks)
    .where(and(eq(tasks.id, req.params.taskId), eq(tasks.project_id, req.params.projectId))).get();
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const { title, description, status, priority, due_date, images, links, doc_type }: UpdateTaskInput = req.body;

  const updated = {
    ...task,
    title: title?.trim() ?? task.title,
    description: description ?? task.description,
    status: (status ?? task.status) as 'todo' | 'in_progress' | 'done',
    priority: (priority ?? task.priority) as 'low' | 'medium' | 'high' | 'urgent',
    due_date: due_date !== undefined ? due_date : task.due_date,
    images: images !== undefined ? JSON.stringify(images) : task.images,
    links: links !== undefined ? JSON.stringify(links) : task.links,
    doc_type: doc_type !== undefined ? doc_type : task.doc_type,
    updated_at: now(),
  };
  await db.update(tasks).set(updated).where(eq(tasks.id, req.params.taskId)).run();

  const actor = actorOf(req);
  const oldLinks = JSON.parse(task.links || '[]');
  const newLinks = links !== undefined ? links : oldLinks;
  if (Array.isArray(newLinks) && newLinks.length > oldLinks.length) {
    await logActivity({ actor, type: 'link_added', task_id: task.id, project_id: task.project_id,
      task_title: updated.title, summary: `Added link to "${updated.title}"` });
  } else if (status !== undefined && status !== task.status) {
    if (status === 'done') {
      await logActivity({ actor, type: 'task_completed', task_id: task.id, project_id: task.project_id,
        task_title: updated.title, summary: `Completed "${updated.title}"` });
    } else {
      await logActivity({ actor, type: 'status_changed', task_id: task.id, project_id: task.project_id,
        task_title: updated.title, summary: `Moved "${updated.title}" to ${status}`, detail: { from: task.status, to: status } });
    }
  } else {
    await logActivity({ actor, type: 'task_updated', task_id: task.id, project_id: task.project_id,
      task_title: updated.title, summary: `Updated "${updated.title}"` });
  }
  return res.json(parseTaskRow(updated));
});

// DELETE /api/projects/:projectId/tasks/:taskId
router.delete('/:taskId', async (req: Request, res: Response) => {
  const task = await db.select().from(tasks)
    .where(and(eq(tasks.id, req.params.taskId), eq(tasks.project_id, req.params.projectId))).get();
  if (!task) return res.status(404).json({ error: 'Task not found' });
  await db.delete(tasks).where(eq(tasks.id, req.params.taskId)).run();
  await logActivity({ actor: actorOf(req), type: 'task_deleted', task_id: task.id, project_id: task.project_id,
    task_title: task.title, summary: `Deleted "${task.title}"` });
  return res.status(204).send();
});

// PATCH /api/projects/:projectId/tasks/:taskId/status
router.patch('/:taskId/status', async (req: Request, res: Response) => {
  const task = await db.select().from(tasks)
    .where(and(eq(tasks.id, req.params.taskId), eq(tasks.project_id, req.params.projectId))).get();
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const { status } = req.body;
  if (!['todo', 'in_progress', 'done'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const updated = { ...task, status, updated_at: now() };
  await db.update(tasks).set(updated).where(eq(tasks.id, req.params.taskId)).run();

  const actor = actorOf(req);
  if (status !== task.status) {
    if (status === 'done') {
      await logActivity({ actor, type: 'task_completed', task_id: task.id, project_id: task.project_id,
        task_title: task.title, summary: `Completed "${task.title}"` });
    } else {
      await logActivity({ actor, type: 'status_changed', task_id: task.id, project_id: task.project_id,
        task_title: task.title, summary: `Moved "${task.title}" to ${status}`, detail: { from: task.status, to: status } });
    }
  }
  return res.json(parseTaskRow(updated));
});

export default router;
```

- [ ] **Step 6: Mount the activity route in `backend/src/index.ts`** — add `import activityRouter from './routes/activity';` and `app.use('/api/activity', activityRouter);`.

- [ ] **Step 7: Run verification and commit**
Run: `npm --prefix backend test src/test/activity.test.ts` → Expected: all pass.
```bash
git add backend/src/lib/actor.ts backend/src/lib/activity.ts backend/src/routes/activity.ts backend/src/routes/tasks.ts backend/src/index.ts backend/src/test/activity.test.ts
git commit -m "feat(api): activity log + actor attribution wired into task mutations"
```

---

### Task 4: Proposals API + apply logic + dedupe

**Goal:** Implement the proposals lifecycle (create with dedupe, edit, approve-and-apply by kind, decline, bulk) at `/api/proposals`.

**Files:**
- Create: `backend/src/routes/proposals.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/src/test/proposals.test.ts`

**Acceptance Criteria:**
- [ ] Create returns 201; second create with same `dedupe_key` while pending updates it (200); a create matching a declined key returns `{skipped:true}` (200).
- [ ] PATCH edits a pending proposal (409 if not pending, 404 if missing).
- [ ] Approve applies by kind: `create_task` inserts into the target project; `create_project` creates project + tasks; `update_task` mutates the target task; already-decided → 409.
- [ ] Decline marks declined; bulk approve/decline returns a summary.

**Verify:** `npm --prefix backend test src/test/proposals.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write tests `backend/src/test/proposals.test.ts`**
```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../index';

function propBody(overrides: any = {}) {
  return {
    kind: 'create_task', source: 'meeting_notes', title: 'Do the thing',
    payload: { project_id: 'general', title: 'Do the thing' }, ...overrides,
  };
}

describe('proposals', () => {
  it('creates a proposal (201) and lists it pending', async () => {
    const res = await request(app).post('/api/proposals').send(propBody());
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    const list = await request(app).get('/api/proposals?status=pending');
    expect(list.body.some((p: any) => p.id === res.body.id)).toBe(true);
    expect(typeof list.body[0].payload).toBe('object');
  });

  it('dedupe updates a pending proposal in place (200)', async () => {
    const key = 'meeting:doc1:abc';
    const first = await request(app).post('/api/proposals').send(propBody({ dedupe_key: key }));
    const second = await request(app).post('/api/proposals').send(propBody({ dedupe_key: key, title: 'Updated title' }));
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.title).toBe('Updated title');
    const list = await request(app).get('/api/proposals');
    expect(list.body.filter((p: any) => p.dedupe_key === key).length).toBe(1);
  });

  it('dedupe skips when a declined proposal exists for the key', async () => {
    const key = 'meeting:doc2:xyz';
    const first = await request(app).post('/api/proposals').send(propBody({ dedupe_key: key }));
    await request(app).post(`/api/proposals/${first.body.id}/decline`);
    const again = await request(app).post('/api/proposals').send(propBody({ dedupe_key: key }));
    expect(again.status).toBe(200);
    expect(again.body.skipped).toBe(true);
  });

  it('edits a pending proposal, 409 once applied', async () => {
    const p = await request(app).post('/api/proposals').send(propBody());
    const patched = await request(app).patch(`/api/proposals/${p.body.id}`)
      .send({ title: 'Edited', payload: { project_id: 'general', title: 'Edited' } });
    expect(patched.status).toBe(200);
    expect(patched.body.title).toBe('Edited');
    await request(app).post(`/api/proposals/${p.body.id}/approve`);
    const late = await request(app).patch(`/api/proposals/${p.body.id}`).send({ title: 'Nope' });
    expect(late.status).toBe(409);
  });

  it('approve create_task inserts the task into the project', async () => {
    const p = await request(app).post('/api/proposals')
      .send(propBody({ payload: { project_id: 'general', title: 'Approved task' } }));
    const ap = await request(app).post(`/api/proposals/${p.body.id}/approve`);
    expect(ap.status).toBe(200);
    const tasks = await request(app).get('/api/projects/general/tasks');
    expect(tasks.body.some((t: any) => t.title === 'Approved task')).toBe(true);
    const dup = await request(app).post(`/api/proposals/${p.body.id}/approve`);
    expect(dup.status).toBe(409);
  });

  it('approve create_project creates the project and its lifecycle tasks', async () => {
    const p = await request(app).post('/api/proposals').send({
      kind: 'create_project', source: 'roadmap_gap', title: 'New Initiative',
      payload: { name: 'New Initiative', tasks: [
        { project_id: '', title: 'Kickoff' }, { project_id: '', title: 'Launch' },
      ] },
    });
    const ap = await request(app).post(`/api/proposals/${p.body.id}/approve`);
    expect(ap.status).toBe(200);
    const projId = ap.body.result_project_id;
    expect(projId).toBeTruthy();
    const projs = await request(app).get('/api/projects');
    expect(projs.body.some((x: any) => x.name === 'New Initiative')).toBe(true);
    const tasks = await request(app).get(`/api/projects/${projId}/tasks`);
    expect(tasks.body.map((t: any) => t.title).sort()).toEqual(['Kickoff', 'Launch']);
  });

  it('approve update_task mutates the target task', async () => {
    const t = (await request(app).post('/api/projects/general/tasks').send({ title: 'Mutate me' })).body;
    const p = await request(app).post('/api/proposals').send({
      kind: 'update_task', source: 'slack', title: 'Mark done',
      target_task_id: t.id, payload: { status: 'done' },
    });
    await request(app).post(`/api/proposals/${p.body.id}/approve`);
    const got = await request(app).get(`/api/projects/general/tasks/${t.id}`);
    expect(got.body.status).toBe('done');
  });

  it('declines a proposal', async () => {
    const p = await request(app).post('/api/proposals').send(propBody());
    const d = await request(app).post(`/api/proposals/${p.body.id}/decline`);
    expect(d.status).toBe(200);
    expect(d.body.status).toBe('declined');
  });

  it('bulk approves and declines', async () => {
    const a = await request(app).post('/api/proposals').send(propBody({ payload: { project_id: 'general', title: 'Bulk A' } }));
    const b = await request(app).post('/api/proposals').send(propBody({ payload: { project_id: 'general', title: 'Bulk B' } }));
    const res = await request(app).post('/api/proposals/bulk').send({ action: 'approve', ids: [a.body.id, b.body.id] });
    expect(res.status).toBe(200);
    expect(res.body.approved).toBe(2);
  });
});
```

- [ ] **Step 2: Create `backend/src/routes/proposals.ts`**
```ts
import { Router, Request, Response } from 'express';
import { eq, desc, and, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import { proposals, tasks, projects } from '../db/schema';
import { actorOf, Actor } from '../lib/actor';
import { logActivity } from '../lib/activity';
import type { CreateTaskPayload, UpdateTaskPayload, CreateProjectPayload } from '../../../shared/types';

const router = Router();

function now() { return new Date().toISOString(); }
function parseProposal(row: any) {
  if (!row) return row;
  return { ...row, payload: JSON.parse(row.payload || '{}') };
}

async function applyCreateTask(actor: Actor, payload: CreateTaskPayload): Promise<string> {
  const projectId = payload.project_id;
  const status = (payload.status ?? 'todo') as 'todo' | 'in_progress' | 'done';
  await db.update(tasks).set({ position: sql`${tasks.position} + 1` })
    .where(and(eq(tasks.project_id, projectId), eq(tasks.status, status))).run();
  const id = uuidv4();
  const ts = now();
  const task = {
    id, project_id: projectId, title: payload.title.trim(), description: payload.description ?? '', status,
    priority: (payload.priority ?? 'medium') as 'low' | 'medium' | 'high' | 'urgent',
    due_date: payload.due_date ?? null, position: 0, images: '[]',
    links: JSON.stringify(payload.links ?? []), doc_type: payload.doc_type ?? null,
    source: 'manual' as const, slack_raw: null, created_at: ts, updated_at: ts,
  };
  await db.insert(tasks).values(task).run();
  await logActivity({ actor, type: 'task_created', task_id: id, project_id: projectId,
    task_title: task.title, summary: `Created task "${task.title}" (from proposal)` });
  return id;
}

async function applyUpdateTask(actor: Actor, taskId: string, payload: UpdateTaskPayload): Promise<void> {
  const existing = await db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!existing) return;
  const updated = {
    ...existing,
    title: payload.title?.trim() ?? existing.title,
    description: payload.description ?? existing.description,
    status: (payload.status ?? existing.status) as 'todo' | 'in_progress' | 'done',
    priority: (payload.priority ?? existing.priority) as 'low' | 'medium' | 'high' | 'urgent',
    due_date: payload.due_date !== undefined ? payload.due_date : existing.due_date,
    links: payload.links !== undefined ? JSON.stringify(payload.links) : existing.links,
    doc_type: payload.doc_type !== undefined ? payload.doc_type : existing.doc_type,
    updated_at: now(),
  };
  await db.update(tasks).set(updated).where(eq(tasks.id, taskId)).run();
  await logActivity({ actor, type: 'task_updated', task_id: taskId, project_id: existing.project_id,
    task_title: updated.title, summary: `Updated "${updated.title}" (from proposal)` });
}

async function applyCreateProject(actor: Actor, payload: CreateProjectPayload): Promise<string> {
  const projId = uuidv4();
  const ts = now();
  await db.insert(projects).values({
    id: projId, name: payload.name.trim(), description: payload.description ?? '',
    status: 'active', created_at: ts, updated_at: ts,
  }).run();
  let pos = 0;
  for (const t of payload.tasks ?? []) {
    const tid = uuidv4();
    const tts = now();
    await db.insert(tasks).values({
      id: tid, project_id: projId, title: t.title.trim(), description: t.description ?? '',
      status: (t.status ?? 'todo') as 'todo' | 'in_progress' | 'done',
      priority: (t.priority ?? 'medium') as 'low' | 'medium' | 'high' | 'urgent',
      due_date: t.due_date ?? null, position: pos++, images: '[]',
      links: JSON.stringify(t.links ?? []), doc_type: t.doc_type ?? null,
      source: 'manual', slack_raw: null, created_at: tts, updated_at: tts,
    }).run();
  }
  await logActivity({ actor, type: 'project_created', project_id: projId,
    summary: `Created project "${payload.name}" with ${(payload.tasks ?? []).length} task(s) (from proposal)` });
  return projId;
}

async function doApprove(id: string, actor: Actor) {
  const row = await db.select().from(proposals).where(eq(proposals.id, id)).get();
  if (!row) return { status: 404, body: { error: 'Proposal not found' } };
  if (row.status !== 'pending') return { status: 409, body: { error: 'Proposal already decided' } };

  const payload = JSON.parse(row.payload || '{}');
  const ts = now();
  await logActivity({ actor, type: 'proposal_approved', project_id: row.target_project_id, task_id: row.target_task_id,
    summary: `Approved proposal "${row.title}"` });

  let result_task_id: string | null = null;
  let result_project_id: string | null = null;
  if (row.kind === 'create_task') {
    result_task_id = await applyCreateTask(actor, payload as CreateTaskPayload);
  } else if (row.kind === 'update_task') {
    if (row.target_task_id) await applyUpdateTask(actor, row.target_task_id, payload as UpdateTaskPayload);
  } else if (row.kind === 'create_project') {
    result_project_id = await applyCreateProject(actor, payload as CreateProjectPayload);
  }

  // (Phase 3 inserts outbox-enqueue here — see Task 17.)

  await db.update(proposals).set({
    status: 'applied', decided_at: ts, updated_at: ts, result_task_id, result_project_id,
  }).where(eq(proposals.id, id)).run();

  const updated = await db.select().from(proposals).where(eq(proposals.id, id)).get();
  return { status: 200, body: parseProposal(updated) };
}

async function doDecline(id: string, actor: Actor) {
  const row = await db.select().from(proposals).where(eq(proposals.id, id)).get();
  if (!row) return { status: 404, body: { error: 'Proposal not found' } };
  if (row.status !== 'pending') return { status: 409, body: { error: 'Proposal already decided' } };
  const ts = now();
  await db.update(proposals).set({ status: 'declined', decided_at: ts, updated_at: ts }).where(eq(proposals.id, id)).run();
  await logActivity({ actor, type: 'proposal_declined', summary: `Declined proposal "${row.title}"` });
  const updated = await db.select().from(proposals).where(eq(proposals.id, id)).get();
  return { status: 200, body: parseProposal(updated) };
}

// GET /api/proposals?status=pending
router.get('/', async (req: Request, res: Response) => {
  const status = req.query.status;
  const rows = await db.select().from(proposals).orderBy(desc(proposals.created_at)).all();
  const filtered = typeof status === 'string' && status.length > 0 ? rows.filter((r) => r.status === status) : rows;
  res.json(filtered.map(parseProposal));
});

// POST /api/proposals
router.post('/', async (req: Request, res: Response) => {
  const input = req.body;
  if (!input?.kind || !input?.source || !input?.title || input?.payload === undefined) {
    return res.status(400).json({ error: 'kind, source, title, payload are required' });
  }
  const actor = actorOf(req);
  const ts = now();

  if (input.dedupe_key) {
    const existing = await db.select().from(proposals).where(eq(proposals.dedupe_key, input.dedupe_key)).get();
    if (existing) {
      if (existing.status === 'pending') {
        const merged = {
          title: input.title, rationale: input.rationale ?? existing.rationale,
          target_project_id: input.target_project_id ?? existing.target_project_id,
          target_task_id: input.target_task_id ?? existing.target_task_id,
          payload: JSON.stringify(input.payload), confidence: input.confidence ?? existing.confidence,
          updated_at: ts,
        };
        await db.update(proposals).set(merged).where(eq(proposals.id, existing.id)).run();
        const updated = await db.select().from(proposals).where(eq(proposals.id, existing.id)).get();
        return res.status(200).json(parseProposal(updated));
      }
      return res.status(200).json({ skipped: true, id: existing.id, status: existing.status });
    }
  }

  const id = uuidv4();
  const row = {
    id, created_at: ts, updated_at: ts, kind: input.kind, status: 'pending',
    source: input.source, actor, dedupe_key: input.dedupe_key ?? null,
    title: input.title, rationale: input.rationale ?? '',
    target_project_id: input.target_project_id ?? null, target_task_id: input.target_task_id ?? null,
    payload: JSON.stringify(input.payload), confidence: input.confidence ?? null,
    result_task_id: null, result_project_id: null, decided_at: null,
  };
  await db.insert(proposals).values(row).run();
  await logActivity({ actor, type: 'proposal_created', project_id: row.target_project_id, task_id: row.target_task_id,
    summary: `Proposed: "${row.title}"`, detail: { kind: row.kind, source: row.source } });
  return res.status(201).json(parseProposal(row));
});

// PATCH /api/proposals/:id
router.patch('/:id', async (req: Request, res: Response) => {
  const row = await db.select().from(proposals).where(eq(proposals.id, req.params.id)).get();
  if (!row) return res.status(404).json({ error: 'Proposal not found' });
  if (row.status !== 'pending') return res.status(409).json({ error: 'Proposal not pending' });

  const { title, rationale, payload, target_project_id, target_task_id } = req.body;
  const updated = {
    title: title ?? row.title, rationale: rationale ?? row.rationale,
    payload: payload !== undefined ? JSON.stringify(payload) : row.payload,
    target_project_id: target_project_id !== undefined ? target_project_id : row.target_project_id,
    target_task_id: target_task_id !== undefined ? target_task_id : row.target_task_id,
    updated_at: now(),
  };
  await db.update(proposals).set(updated).where(eq(proposals.id, req.params.id)).run();
  const fresh = await db.select().from(proposals).where(eq(proposals.id, req.params.id)).get();
  return res.json(parseProposal(fresh));
});

// POST /api/proposals/bulk  (registered before /:id/* so it matches first)
router.post('/bulk', async (req: Request, res: Response) => {
  const { action, ids } = req.body as { action: 'approve' | 'decline'; ids: string[] };
  if (!['approve', 'decline'].includes(action) || !Array.isArray(ids)) {
    return res.status(400).json({ error: 'action and ids[] are required' });
  }
  const actor = actorOf(req);
  const summary = { approved: 0, declined: 0, errors: [] as { id: string; error: string }[] };
  for (const id of ids) {
    const r = action === 'approve' ? await doApprove(id, actor) : await doDecline(id, actor);
    if (r.status >= 400) summary.errors.push({ id, error: (r.body as any).error });
    else if (action === 'approve') summary.approved++;
    else summary.declined++;
  }
  return res.json(summary);
});

// POST /api/proposals/:id/approve
router.post('/:id/approve', async (req: Request, res: Response) => {
  const r = await doApprove(req.params.id, actorOf(req));
  return res.status(r.status).json(r.body);
});

// POST /api/proposals/:id/decline
router.post('/:id/decline', async (req: Request, res: Response) => {
  const r = await doDecline(req.params.id, actorOf(req));
  return res.status(r.status).json(r.body);
});

export default router;
```
(Note: `/bulk` is registered before the `/:id/*` routes so Express matches it first.)

- [ ] **Step 3: Mount the proposals route in `backend/src/index.ts`** — add `import proposalsRouter from './routes/proposals';` and `app.use('/api/proposals', proposalsRouter);`.

- [ ] **Step 4: Run verification and commit**
Run: `npm --prefix backend test src/test/proposals.test.ts` → Expected: all pass.
```bash
git add backend/src/routes/proposals.ts backend/src/index.ts backend/src/test/proposals.test.ts
git commit -m "feat(api): proposals lifecycle with dedupe, apply-by-kind, and bulk actions"
```

---

### Task 5: Briefings API

**Goal:** Add `POST /api/briefing` (upsert) and `GET /api/briefing?date=` (default today, empty-when-absent) so routines can persist structured briefing sections.

**Files:**
- Create: `backend/src/routes/briefing.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/src/test/briefing.test.ts`

**Acceptance Criteria:**
- [ ] POST then GET the same date returns the stored sections.
- [ ] POST twice for a date replaces the sections (upsert).
- [ ] GET for a missing date returns `{date, sections:{}, created_at:null}`.

**Verify:** `npm --prefix backend test src/test/briefing.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write tests `backend/src/test/briefing.test.ts`**
```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../index';

describe('briefings', () => {
  it('upserts and reads back a briefing', async () => {
    const sections = { must_do: ['Ship it'], data_gaps: [] };
    const post = await request(app).post('/api/briefing').send({ date: '2026-09-14', sections });
    expect(post.status).toBe(200);
    const get = await request(app).get('/api/briefing?date=2026-09-14');
    expect(get.body.sections.must_do).toEqual(['Ship it']);
    expect(get.body.created_at).toBeTruthy();
  });

  it('replaces sections on repeat POST', async () => {
    await request(app).post('/api/briefing').send({ date: '2026-09-15', sections: { must_do: ['old'] } });
    await request(app).post('/api/briefing').send({ date: '2026-09-15', sections: { must_do: ['new'] } });
    const get = await request(app).get('/api/briefing?date=2026-09-15');
    expect(get.body.sections.must_do).toEqual(['new']);
  });

  it('returns empty sections when the date is absent', async () => {
    const get = await request(app).get('/api/briefing?date=1999-01-01');
    expect(get.body).toEqual({ date: '1999-01-01', sections: {}, created_at: null });
  });
});
```

- [ ] **Step 2: Create `backend/src/routes/briefing.ts`**
```ts
import { Router, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { briefings } from '../db/schema';

const router = Router();

function today() { return new Date().toISOString().split('T')[0]; }

// POST /api/briefing  { date, sections }
router.post('/', async (req: Request, res: Response) => {
  const { date, sections } = req.body as { date?: string; sections?: unknown };
  if (!date) return res.status(400).json({ error: 'date is required' });
  const ts = new Date().toISOString();
  const sectionsJson = JSON.stringify(sections ?? {});
  await db.insert(briefings)
    .values({ date, sections: sectionsJson, created_at: ts })
    .onConflictDoUpdate({ target: briefings.date, set: { sections: sectionsJson, created_at: ts } })
    .run();
  return res.json({ date, sections: sections ?? {}, created_at: ts });
});

// GET /api/briefing?date=YYYY-MM-DD
router.get('/', async (req: Request, res: Response) => {
  const date = typeof req.query.date === 'string' && req.query.date ? req.query.date : today();
  const row = await db.select().from(briefings).where(eq(briefings.date, date)).get();
  if (!row) return res.json({ date, sections: {}, created_at: null });
  return res.json({ date: row.date, sections: JSON.parse(row.sections || '{}'), created_at: row.created_at });
});

export default router;
```

- [ ] **Step 3: Mount in `backend/src/index.ts`** — add `import briefingRouter from './routes/briefing';` and `app.use('/api/briefing', briefingRouter);`.

- [ ] **Step 4: Run verification and commit**
Run: `npm --prefix backend test src/test/briefing.test.ts` → Expected: all pass.
```bash
git add backend/src/routes/briefing.ts backend/src/index.ts backend/src/test/briefing.test.ts
git commit -m "feat(api): briefings upsert/read for the Today cockpit"
```

---

### Task 6: Cross-project upcoming endpoint

**Goal:** Add `GET /api/upcoming?days=N` returning incomplete tasks across all projects that are overdue or due within N days (default 7), enriched with `project_name` (and `idea_key` once Phase 2 adds it), ordered by due date ascending.

**Files:**
- Create: `backend/src/routes/upcoming.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/src/test/upcoming.test.ts`

**Acceptance Criteria:**
- [ ] Overdue and within-window incomplete tasks are returned; beyond-window, done, and no-due-date tasks are excluded.
- [ ] Each row carries `project_name`; results are ordered by `due_date` ascending.
- [ ] `images`/`links` are parsed to arrays.

**Verify:** `npm --prefix backend test src/test/upcoming.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write tests `backend/src/test/upcoming.test.ts`**
```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../index';

async function mkTask(body: any) {
  return (await request(app).post('/api/projects/general/tasks').send(body)).body;
}
function iso(off: number) { const d = new Date(); d.setDate(d.getDate() + off); return d.toISOString().split('T')[0]; }

describe('upcoming', () => {
  it('includes overdue and within-window, excludes beyond-window/done/no-date', async () => {
    await mkTask({ title: 'overdue', due_date: iso(-3) });
    await mkTask({ title: 'soon', due_date: iso(2) });
    await mkTask({ title: 'far', due_date: iso(60) });
    await mkTask({ title: 'nodate' });
    const done = await mkTask({ title: 'done', due_date: iso(1) });
    await request(app).patch(`/api/projects/general/tasks/${done.id}/status`).send({ status: 'done' });
    const res = await request(app).get('/api/upcoming?days=7');
    const titles = res.body.map((t: any) => t.title);
    expect(titles).toContain('overdue');
    expect(titles).toContain('soon');
    expect(titles).not.toContain('far');
    expect(titles).not.toContain('nodate');
    expect(titles).not.toContain('done');
  });

  it('enriches project_name and orders by due_date asc, parsing links', async () => {
    await mkTask({ title: 'b', due_date: iso(5) });
    await mkTask({ title: 'a', due_date: iso(1) });
    const res = await request(app).get('/api/upcoming');
    expect(res.body[0].project_name).toBe('General');
    expect(Array.isArray(res.body[0].links)).toBe(true);
    const dates = res.body.map((t: any) => t.due_date);
    expect([...dates]).toEqual([...dates].sort());
  });
});
```

- [ ] **Step 2: Create `backend/src/routes/upcoming.ts`**
```ts
import { Router, Request, Response } from 'express';
import { db } from '../db';
import { tasks, projects } from '../db/schema';

const router = Router();

function parseTaskRow(row: any) {
  return { ...row, images: JSON.parse(row.images || '[]'), links: JSON.parse(row.links || '[]') };
}

// GET /api/upcoming?days=7
router.get('/', async (req: Request, res: Response) => {
  const raw = parseInt(String(req.query.days ?? '7'), 10);
  const days = Number.isNaN(raw) ? 7 : raw;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const projRows = await db.select().from(projects).all();
  const projName = new Map(projRows.map((p) => [p.id, p.name]));
  // idea_key is added to projects in Phase 2; guard the access so this works in both phases.
  const projIdea = new Map(projRows.map((p) => [p.id, (p as any).idea_key ?? null]));

  const all = await db.select().from(tasks).all();
  const filtered = all
    .filter((t) => t.status !== 'done' && t.due_date != null && t.due_date <= cutoffStr)
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''));

  res.json(filtered.map((t) => ({
    ...parseTaskRow(t),
    project_name: projName.get(t.project_id) ?? '',
    idea_key: projIdea.get(t.project_id) ?? null,
  })));
});

export default router;
```

- [ ] **Step 3: Mount in `backend/src/index.ts`** — add `import upcomingRouter from './routes/upcoming';` and `app.use('/api/upcoming', upcomingRouter);`.

- [ ] **Step 4: Run verification and commit**
Run: `npm --prefix backend test src/test/upcoming.test.ts` → Expected: all pass.
```bash
git add backend/src/routes/upcoming.ts backend/src/index.ts backend/src/test/upcoming.test.ts
git commit -m "feat(api): cross-project upcoming/overdue endpoint for the cockpit"
```

---

### Task 7: Frontend API client + context for proposals/activity/briefing/upcoming

**Goal:** Extend the `api` client and `AppContext` with proposals (list/create/patch/approve/decline/bulk), activity, briefing, and upcoming, so the Cockpit and Inbox can consume them.

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/context/AppContext.tsx`

**Acceptance Criteria:**
- [ ] `api` exposes `getProposals`, `createProposal`, `updateProposal`, `approveProposal`, `declineProposal`, `bulkProposals`, `getActivity`, `getBriefing`, `getUpcoming`.
- [ ] Context exposes matching state (`proposals`, `activity`, `briefing`, `upcoming`) and loaders/actions.
- [ ] `npm --prefix frontend run build` succeeds.

**Verify:** `npm --prefix frontend run build` → build succeeds.

**Steps:**

- [ ] **Step 1: Add client methods to `frontend/src/api/client.ts`** (inside the `api` object, after `getDashboard`)
```ts
  // Proposals (Phase 1)
  getProposals: (status?: string) =>
    request<import('@shared/types').Proposal[]>(`/proposals${status ? `?status=${status}` : ''}`),
  createProposal: (data: import('@shared/types').CreateProposalInput) =>
    request<import('@shared/types').Proposal>('/proposals', { method: 'POST', body: JSON.stringify(data) }),
  updateProposal: (
    id: string,
    data: Partial<{ title: string; rationale: string; payload: unknown; target_project_id: string | null; target_task_id: string | null }>,
  ) => request<import('@shared/types').Proposal>(`/proposals/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  approveProposal: (id: string) =>
    request<import('@shared/types').Proposal>(`/proposals/${id}/approve`, { method: 'POST' }),
  declineProposal: (id: string) =>
    request<import('@shared/types').Proposal>(`/proposals/${id}/decline`, { method: 'POST' }),
  bulkProposals: (action: 'approve' | 'decline', ids: string[]) =>
    request<{ approved: number; declined: number; errors: { id: string; error: string }[] }>(
      '/proposals/bulk', { method: 'POST', body: JSON.stringify({ action, ids }) }),

  // Activity / Briefing / Upcoming (Phase 1)
  getActivity: (limit = 50) =>
    request<import('@shared/types').ActivityEntry[]>(`/activity?limit=${limit}`),
  getBriefing: (date?: string) =>
    request<import('@shared/types').Briefing>(`/briefing${date ? `?date=${date}` : ''}`),
  getUpcoming: (days = 7) =>
    request<import('@shared/types').UpcomingTask[]>(`/upcoming?days=${days}`),
```

- [ ] **Step 2: Replace `frontend/src/context/AppContext.tsx`** with the version below (the original file plus proposals/activity/briefing/upcoming state, actions, reducer cases, loaders, and context value)
```tsx
import React, { createContext, useContext, useReducer, useCallback } from 'react';
import type {
  Project, Task, DashboardStats, TaskStatus,
  Proposal, CreateProposalInput, ActivityEntry, Briefing, UpcomingTask,
} from '@shared/types';
import { api } from '../api/client';

interface AppState {
  projects: Project[];
  archivedProjects: Project[];
  currentProject: Project | null;
  tasks: Task[];
  dashboard: DashboardStats | null;
  proposals: Proposal[];
  activity: ActivityEntry[];
  briefing: Briefing | null;
  upcoming: UpcomingTask[];
  loading: boolean;
  error: string | null;
}

type Action =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_PROJECTS'; payload: Project[] }
  | { type: 'SET_ARCHIVED_PROJECTS'; payload: Project[] }
  | { type: 'ADD_PROJECT'; payload: Project }
  | { type: 'UPDATE_PROJECT'; payload: Project }
  | { type: 'REMOVE_PROJECT'; payload: string }
  | { type: 'SET_CURRENT_PROJECT'; payload: Project | null }
  | { type: 'SET_TASKS'; payload: Task[] }
  | { type: 'ADD_TASK'; payload: Task }
  | { type: 'UPDATE_TASK'; payload: Task }
  | { type: 'REMOVE_TASK'; payload: string }
  | { type: 'SET_DASHBOARD'; payload: DashboardStats }
  | { type: 'SET_PROPOSALS'; payload: Proposal[] }
  | { type: 'SET_ACTIVITY'; payload: ActivityEntry[] }
  | { type: 'SET_BRIEFING'; payload: Briefing }
  | { type: 'SET_UPCOMING'; payload: UpcomingTask[] };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_LOADING': return { ...state, loading: action.payload };
    case 'SET_ERROR': return { ...state, error: action.payload };
    case 'SET_PROJECTS': return { ...state, projects: action.payload };
    case 'SET_ARCHIVED_PROJECTS': return { ...state, archivedProjects: action.payload };
    case 'ADD_PROJECT': return { ...state, projects: [...state.projects, action.payload] };
    case 'UPDATE_PROJECT':
      return { ...state, projects: state.projects.map(p => p.id === action.payload.id ? action.payload : p) };
    case 'REMOVE_PROJECT':
      return { ...state, projects: state.projects.filter(p => p.id !== action.payload) };
    case 'SET_CURRENT_PROJECT': return { ...state, currentProject: action.payload };
    case 'SET_TASKS': return { ...state, tasks: action.payload };
    case 'ADD_TASK': return { ...state, tasks: [...state.tasks, action.payload] };
    case 'UPDATE_TASK':
      return { ...state, tasks: state.tasks.map(t => t.id === action.payload.id ? action.payload : t) };
    case 'REMOVE_TASK':
      return { ...state, tasks: state.tasks.filter(t => t.id !== action.payload) };
    case 'SET_DASHBOARD': return { ...state, dashboard: action.payload };
    case 'SET_PROPOSALS': return { ...state, proposals: action.payload };
    case 'SET_ACTIVITY': return { ...state, activity: action.payload };
    case 'SET_BRIEFING': return { ...state, briefing: action.payload };
    case 'SET_UPCOMING': return { ...state, upcoming: action.payload };
    default: return state;
  }
}

const initialState: AppState = {
  projects: [], archivedProjects: [], currentProject: null, tasks: [],
  dashboard: null, proposals: [], activity: [], briefing: null, upcoming: [],
  loading: false, error: null,
};

interface AppContextValue {
  state: AppState;
  loadProjects: () => Promise<void>;
  loadArchivedProjects: () => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  createProject: (name: string, description?: string) => Promise<Project>;
  updateProject: (id: string, data: Parameters<typeof api.updateProject>[1]) => Promise<void>;
  archiveProject: (id: string) => Promise<void>;
  restoreProject: (id: string) => Promise<void>;
  loadTasks: (projectId: string) => Promise<void>;
  createTask: (projectId: string, data: Parameters<typeof api.createTask>[1]) => Promise<Task>;
  updateTask: (projectId: string, taskId: string, data: Parameters<typeof api.updateTask>[2]) => Promise<void>;
  updateTaskStatus: (projectId: string, taskId: string, status: TaskStatus) => Promise<void>;
  reorderTasks: (projectId: string, columns: Record<string, string[]>, optimisticTasks: Task[]) => Promise<void>;
  deleteTask: (projectId: string, taskId: string) => Promise<void>;
  loadDashboard: () => Promise<void>;
  loadProposals: (status?: string) => Promise<void>;
  createProposal: (data: CreateProposalInput) => Promise<Proposal>;
  patchProposal: (id: string, data: Parameters<typeof api.updateProposal>[1]) => Promise<void>;
  approveProposal: (id: string) => Promise<void>;
  declineProposal: (id: string) => Promise<void>;
  bulkProposals: (action: 'approve' | 'decline', ids: string[]) => Promise<void>;
  loadActivity: (limit?: number) => Promise<void>;
  loadBriefing: (date?: string) => Promise<void>;
  loadUpcoming: (days?: number) => Promise<void>;
  clearError: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const loadProjects = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const projects = await api.getProjects();
      dispatch({ type: 'SET_PROJECTS', payload: projects });
    } catch (e) {
      dispatch({ type: 'SET_ERROR', payload: (e as Error).message });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, []);

  const loadProject = useCallback(async (id: string) => {
    try {
      const project = await api.getProject(id);
      dispatch({ type: 'SET_CURRENT_PROJECT', payload: project });
    } catch (e) {
      dispatch({ type: 'SET_ERROR', payload: (e as Error).message });
    }
  }, []);

  const createProject = useCallback(async (name: string, description = '') => {
    const project = await api.createProject({ name, description });
    dispatch({ type: 'ADD_PROJECT', payload: project });
    return project;
  }, []);

  const updateProject = useCallback(async (id: string, data: Parameters<typeof api.updateProject>[1]) => {
    const updated = await api.updateProject(id, data);
    dispatch({ type: 'UPDATE_PROJECT', payload: updated });
    if (state.currentProject?.id === id) dispatch({ type: 'SET_CURRENT_PROJECT', payload: updated });
  }, [state.currentProject]);

  const loadArchivedProjects = useCallback(async () => {
    try {
      const archived = await api.getArchivedProjects();
      dispatch({ type: 'SET_ARCHIVED_PROJECTS', payload: archived });
    } catch (e) {
      dispatch({ type: 'SET_ERROR', payload: (e as Error).message });
    }
  }, []);

  const archiveProject = useCallback(async (id: string) => {
    await api.archiveProject(id);
    dispatch({ type: 'REMOVE_PROJECT', payload: id });
    try {
      const archived = await api.getArchivedProjects();
      dispatch({ type: 'SET_ARCHIVED_PROJECTS', payload: archived });
    } catch {}
  }, []);

  const restoreProject = useCallback(async (id: string) => {
    const restored = await api.restoreProject(id);
    dispatch({ type: 'ADD_PROJECT', payload: restored });
    dispatch({ type: 'SET_ARCHIVED_PROJECTS', payload: [] });
    try {
      const archived = await api.getArchivedProjects();
      dispatch({ type: 'SET_ARCHIVED_PROJECTS', payload: archived });
    } catch {}
  }, []);

  const loadTasks = useCallback(async (projectId: string) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const tasks = await api.getTasks(projectId);
      dispatch({ type: 'SET_TASKS', payload: tasks });
    } catch (e) {
      dispatch({ type: 'SET_ERROR', payload: (e as Error).message });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, []);

  const createTask = useCallback(async (projectId: string, data: Parameters<typeof api.createTask>[1]) => {
    const task = await api.createTask(projectId, data);
    dispatch({ type: 'ADD_TASK', payload: task });
    return task;
  }, []);

  const updateTask = useCallback(async (projectId: string, taskId: string, data: Parameters<typeof api.updateTask>[2]) => {
    const updated = await api.updateTask(projectId, taskId, data);
    dispatch({ type: 'UPDATE_TASK', payload: updated });
  }, []);

  const updateTaskStatus = useCallback(async (projectId: string, taskId: string, status: TaskStatus) => {
    const optimistic = state.tasks.find(t => t.id === taskId);
    if (optimistic) dispatch({ type: 'UPDATE_TASK', payload: { ...optimistic, status } });
    try {
      const updated = await api.updateTaskStatus(projectId, taskId, status);
      dispatch({ type: 'UPDATE_TASK', payload: updated });
    } catch (e) {
      if (optimistic) dispatch({ type: 'UPDATE_TASK', payload: optimistic });
      dispatch({ type: 'SET_ERROR', payload: (e as Error).message });
    }
  }, [state.tasks]);

  const reorderTasks = useCallback(async (projectId: string, columns: Record<string, string[]>, optimisticTasks: Task[]) => {
    dispatch({ type: 'SET_TASKS', payload: optimisticTasks });
    try {
      const updated = await api.reorderTasks(projectId, columns);
      dispatch({ type: 'SET_TASKS', payload: updated });
    } catch (e) {
      try {
        const tasks = await api.getTasks(projectId);
        dispatch({ type: 'SET_TASKS', payload: tasks });
      } catch {}
      dispatch({ type: 'SET_ERROR', payload: (e as Error).message });
    }
  }, []);

  const deleteTask = useCallback(async (projectId: string, taskId: string) => {
    await api.deleteTask(projectId, taskId);
    dispatch({ type: 'REMOVE_TASK', payload: taskId });
  }, []);

  const loadDashboard = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const dashboard = await api.getDashboard();
      dispatch({ type: 'SET_DASHBOARD', payload: dashboard });
    } catch (e) {
      dispatch({ type: 'SET_ERROR', payload: (e as Error).message });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, []);

  const loadProposals = useCallback(async (status?: string) => {
    try {
      const proposals = await api.getProposals(status);
      dispatch({ type: 'SET_PROPOSALS', payload: proposals });
    } catch (e) {
      dispatch({ type: 'SET_ERROR', payload: (e as Error).message });
    }
  }, []);

  const createProposal = useCallback(async (data: CreateProposalInput) => {
    return api.createProposal(data);
  }, []);

  const patchProposal = useCallback(async (id: string, data: Parameters<typeof api.updateProposal>[1]) => {
    await api.updateProposal(id, data);
    const proposals = await api.getProposals('pending');
    dispatch({ type: 'SET_PROPOSALS', payload: proposals });
  }, []);

  const approveProposal = useCallback(async (id: string) => {
    await api.approveProposal(id);
    const proposals = await api.getProposals('pending');
    dispatch({ type: 'SET_PROPOSALS', payload: proposals });
  }, []);

  const declineProposal = useCallback(async (id: string) => {
    await api.declineProposal(id);
    const proposals = await api.getProposals('pending');
    dispatch({ type: 'SET_PROPOSALS', payload: proposals });
  }, []);

  const bulkProposals = useCallback(async (action: 'approve' | 'decline', ids: string[]) => {
    await api.bulkProposals(action, ids);
    const proposals = await api.getProposals('pending');
    dispatch({ type: 'SET_PROPOSALS', payload: proposals });
  }, []);

  const loadActivity = useCallback(async (limit = 50) => {
    try {
      const activity = await api.getActivity(limit);
      dispatch({ type: 'SET_ACTIVITY', payload: activity });
    } catch (e) {
      dispatch({ type: 'SET_ERROR', payload: (e as Error).message });
    }
  }, []);

  const loadBriefing = useCallback(async (date?: string) => {
    try {
      const briefing = await api.getBriefing(date);
      dispatch({ type: 'SET_BRIEFING', payload: briefing });
    } catch (e) {
      dispatch({ type: 'SET_ERROR', payload: (e as Error).message });
    }
  }, []);

  const loadUpcoming = useCallback(async (days = 7) => {
    try {
      const upcoming = await api.getUpcoming(days);
      dispatch({ type: 'SET_UPCOMING', payload: upcoming });
    } catch (e) {
      dispatch({ type: 'SET_ERROR', payload: (e as Error).message });
    }
  }, []);

  const clearError = useCallback(() => dispatch({ type: 'SET_ERROR', payload: null }), []);

  return (
    <AppContext.Provider value={{
      state, loadProjects, loadArchivedProjects, loadProject, createProject, updateProject, archiveProject, restoreProject,
      loadTasks, createTask, updateTask, updateTaskStatus, reorderTasks, deleteTask, loadDashboard,
      loadProposals, createProposal, patchProposal, approveProposal, declineProposal, bulkProposals,
      loadActivity, loadBriefing, loadUpcoming, clearError,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
```

- [ ] **Step 3: Run verification and commit** (build after Task 8/9 exist, since App.tsx will import the new pages)
Run: `npm --prefix frontend run build` (may be deferred until Task 9) → Expected: build succeeds.
```bash
git add frontend/src/api/client.ts frontend/src/context/AppContext.tsx
git commit -m "feat(ui): api client + context for proposals, activity, briefing, upcoming"
```

---

### Task 8: Nav restructure + Cockpit ("Today") page

**Goal:** Add routes for Cockpit (`/`), the existing Dashboard (`/dashboard`), and Inbox (`/inbox`); update the sidebar with Today/Inbox(pending badge)/Dashboard; build the Cockpit page rendering briefing sections, the upcoming list with inline complete/reschedule, and a recent-activity feed with actor badges.

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`
- Create: `frontend/src/components/cockpit/Cockpit.tsx`

**Acceptance Criteria:**
- [ ] `/` renders Cockpit; `/dashboard` renders the existing Dashboard; `/inbox` renders Inbox.
- [ ] Sidebar shows Today, Inbox (with a pending-proposal count badge), and Dashboard links.
- [ ] Cockpit shows briefing sections, upcoming tasks with working Complete and Reschedule actions, and an activity feed with claude/user badges.
- [ ] `npm --prefix frontend run build` succeeds.

**Verify:** `npm --prefix frontend run build` → build succeeds (after Task 9's Inbox exists).

**Steps:**

- [ ] **Step 1: Replace `frontend/src/App.tsx`**
```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { Layout } from './components/layout/Layout';
import { Cockpit } from './components/cockpit/Cockpit';
import { Inbox } from './components/inbox/Inbox';
import { Dashboard } from './components/dashboard/Dashboard';
import { ProjectList } from './components/projects/ProjectList';
import { ProjectForm } from './components/projects/ProjectForm';
import { ProjectDetail } from './components/projects/ProjectDetail';

function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Cockpit />} />
            <Route path="/inbox" element={<Inbox />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/projects" element={<ProjectList />} />
            <Route path="/projects/new" element={<ProjectForm />} />
            <Route path="/projects/:projectId/edit" element={<ProjectForm />} />
            <Route path="/projects/:projectId" element={<ProjectDetail />} />
          </Route>
        </Routes>
      </AppProvider>
    </BrowserRouter>
  );
}

export default App;
```

- [ ] **Step 2: Update `frontend/src/components/layout/Sidebar.tsx`** — change the hook line to also pull `loadProposals`, load pending proposals in the first effect, and replace the single Dashboard nav `<div className="px-3 mb-2">…</div>` with the Today/Inbox/Dashboard group:
```tsx
  const { state, loadProjects, loadArchivedProjects, restoreProject, loadProposals } = useApp();
```
```tsx
  useEffect(() => {
    loadProjects();
    loadProposals('pending');
  }, [loadProjects, loadProposals]);
```
```tsx
        <div className="px-3 mb-2 space-y-1">
          <Link
            to="/"
            className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              location.pathname === '/' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Today
          </Link>
          <Link
            to="/inbox"
            className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              location.pathname === '/inbox' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            Inbox
            {state.proposals.length > 0 && (
              <span className="ml-auto text-xs bg-indigo-500 text-white rounded-full px-1.5 py-0.5">
                {state.proposals.length}
              </span>
            )}
          </Link>
          <Link
            to="/dashboard"
            className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              location.pathname === '/dashboard' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            Dashboard
          </Link>
        </div>
```
(`state.proposals` holds pending proposals from the `loadProposals('pending')` effect, so its length is the badge count. Roadmap and Outbox links are added into this same group in Tasks 15 and 19.)

- [ ] **Step 3: Create `frontend/src/components/cockpit/Cockpit.tsx`**
```tsx
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import type { BriefingSections, UpcomingTask, ActivityEntry } from '@shared/types';

const SECTION_LABELS: { key: keyof BriefingSections; label: string }[] = [
  { key: 'catch_up', label: 'Catch-Up' },
  { key: 'must_do', label: 'Must Do Today' },
  { key: 'should_do', label: 'Should Do Today' },
  { key: 'if_time', label: 'If Time Allows' },
  { key: 'stakeholder_updates', label: 'Stakeholder Updates' },
  { key: 'data_gaps', label: 'Data Gaps This Run' },
];

export function Cockpit() {
  const { state, loadBriefing, loadUpcoming, loadActivity, updateTaskStatus, updateTask } = useApp();

  useEffect(() => {
    loadBriefing();
    loadUpcoming(7);
    loadActivity(30);
  }, [loadBriefing, loadUpcoming, loadActivity]);

  const sections = state.briefing?.sections ?? {};
  const hasBriefing = SECTION_LABELS.some(({ key }) => (sections[key] ?? []).length > 0);
  const today = new Date().toISOString().split('T')[0];

  const handleComplete = async (t: UpcomingTask) => {
    await updateTaskStatus(t.project_id, t.id, 'done');
    await loadUpcoming(7);
    await loadActivity(30);
  };

  const handleReschedule = async (t: UpcomingTask) => {
    const next = window.prompt('New due date (YYYY-MM-DD):', t.due_date ?? '');
    if (!next) return;
    await updateTask(t.project_id, t.id, { due_date: next });
    await loadUpcoming(7);
  };

  return (
    <div className="p-8 max-w-4xl">
      <h2 className="text-2xl font-bold text-slate-800 mb-6">Today</h2>

      <section className="mb-8">
        {hasBriefing ? (
          <div className="space-y-4">
            {SECTION_LABELS.map(({ key, label }) => {
              const items = sections[key] ?? [];
              if (items.length === 0) return null;
              return (
                <div key={key} className="bg-white rounded-xl border border-slate-200 p-5">
                  <h3 className="font-semibold text-slate-700 mb-2">{label}</h3>
                  <ul className="list-disc list-inside space-y-1 text-sm text-slate-600">
                    {items.map((it, i) => <li key={i}>{it}</li>)}
                  </ul>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 p-5 text-slate-500 text-sm">
            No briefing for {today} yet. The morning routine will post one here.
          </div>
        )}
      </section>

      <section className="mb-8">
        <h3 className="font-semibold text-slate-700 mb-3">Upcoming &amp; Overdue</h3>
        {state.upcoming.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing due in the next 7 days.</p>
        ) : (
          <div className="space-y-2">
            {state.upcoming.map((t) => {
              const overdue = t.due_date != null && t.due_date < today;
              return (
                <div key={t.id} className="flex items-center gap-3 bg-white rounded-lg border border-slate-200 p-3">
                  <div className="flex-1 min-w-0">
                    <Link to={`/projects/${t.project_id}`} className="text-sm font-medium text-slate-800 hover:text-indigo-600 truncate block">
                      {t.title}
                    </Link>
                    <div className="text-xs text-slate-500 flex gap-2">
                      <span>{t.project_name}</span>
                      <span className={overdue ? 'text-red-500 font-medium' : ''}>
                        {overdue ? 'Overdue ' : 'Due '}{t.due_date}
                      </span>
                    </div>
                  </div>
                  <button onClick={() => handleReschedule(t)} className="text-xs px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50">Reschedule</button>
                  <button onClick={() => handleComplete(t)} className="text-xs px-2 py-1 rounded bg-green-500 text-white hover:bg-green-600">Complete</button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h3 className="font-semibold text-slate-700 mb-3">Recent Activity</h3>
        {state.activity.length === 0 ? (
          <p className="text-sm text-slate-500">No activity yet.</p>
        ) : (
          <ul className="space-y-1">
            {state.activity.map((a: ActivityEntry) => (
              <li key={a.id} className="flex items-center gap-2 text-sm text-slate-600 py-1">
                <ActorBadge actor={a.actor} />
                <span className="flex-1 truncate">{a.summary}</span>
                <span className="text-xs text-slate-400">{a.created_at.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ActorBadge({ actor }: { actor: 'claude' | 'user' }) {
  const isClaude = actor === 'claude';
  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${isClaude ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>
      {isClaude ? 'Claude' : 'You'}
    </span>
  );
}
```

- [ ] **Step 4: Run verification and commit** (build after Task 9 so the `Inbox` import resolves)
```bash
git add frontend/src/App.tsx frontend/src/components/layout/Sidebar.tsx frontend/src/components/cockpit/Cockpit.tsx
git commit -m "feat(ui): Today cockpit page + Today/Inbox/Dashboard nav"
```

---

### Task 9: Inbox page (proposal review)

**Goal:** Build the Inbox page: pending proposals grouped by source, each card with Approve / Edit (modal) / Decline, bulk approve/decline, and a pending count.

**Files:**
- Create: `frontend/src/components/inbox/Inbox.tsx`

**Acceptance Criteria:**
- [ ] Lists pending proposals grouped by `source` with a total pending count.
- [ ] Per-card Approve, Decline, and an Edit modal that edits title, target project, due date, and priority (and the task list for `create_project`).
- [ ] Bulk approve/decline of selected proposals.
- [ ] `npm --prefix frontend run build` succeeds.

**Verify:** `npm --prefix frontend run build` → build succeeds.

**Steps:**

- [ ] **Step 1: Create `frontend/src/components/inbox/Inbox.tsx`**
```tsx
import { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import type {
  Proposal, CreateTaskPayload, UpdateTaskPayload, CreateProjectPayload, TaskPriority,
} from '@shared/types';

const SOURCE_LABELS: Record<string, string> = {
  meeting_notes: 'Meeting Notes', slack: 'Slack', jira_timeline: 'Jira Timeline',
  roadmap_gap: 'Roadmap Gaps', manual: 'Manual',
};

export function Inbox() {
  const { state, loadProposals, loadProjects, approveProposal, declineProposal, patchProposal, bulkProposals } = useApp();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Proposal | null>(null);

  useEffect(() => {
    loadProposals('pending');
    loadProjects();
  }, [loadProposals, loadProjects]);

  const proposals = state.proposals;
  const grouped = proposals.reduce<Record<string, Proposal[]>>((acc, p) => {
    (acc[p.source] ??= []).push(p);
    return acc;
  }, {});

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const doBulk = async (action: 'approve' | 'decline') => {
    if (selected.size === 0) return;
    await bulkProposals(action, [...selected]);
    setSelected(new Set());
  };

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-800">
          Inbox <span className="text-slate-400 text-lg font-normal">({proposals.length} pending)</span>
        </h2>
        {selected.size > 0 && (
          <div className="flex gap-2">
            <button onClick={() => doBulk('approve')} className="text-sm px-3 py-1.5 rounded bg-green-500 text-white hover:bg-green-600">Approve {selected.size}</button>
            <button onClick={() => doBulk('decline')} className="text-sm px-3 py-1.5 rounded border border-slate-300 text-slate-600 hover:bg-slate-50">Decline {selected.size}</button>
          </div>
        )}
      </div>

      {proposals.length === 0 ? (
        <p className="text-slate-500 text-sm">No pending proposals. Nothing to review.</p>
      ) : (
        Object.entries(grouped).map(([source, items]) => (
          <section key={source} className="mb-8">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">{SOURCE_LABELS[source] ?? source}</h3>
            <div className="space-y-2">
              {items.map((p) => (
                <div key={p.id} className="bg-white rounded-lg border border-slate-200 p-4">
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} className="mt-1" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{p.kind}</span>
                        {p.confidence && <span className="text-xs text-slate-400">{p.confidence} confidence</span>}
                      </div>
                      <p className="text-sm font-medium text-slate-800 mt-1">{p.title}</p>
                      {p.rationale && <p className="text-xs text-slate-500 mt-1">{p.rationale}</p>}
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button onClick={() => setEditing(p)} className="text-xs px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50">Edit</button>
                      <button onClick={() => approveProposal(p.id)} className="text-xs px-2 py-1 rounded bg-green-500 text-white hover:bg-green-600">Approve</button>
                      <button onClick={() => declineProposal(p.id)} className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-600 hover:bg-slate-50">Decline</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}

      {editing && (
        <EditModal
          proposal={editing}
          projects={state.projects.map((p) => ({ id: p.id, name: p.name }))}
          onClose={() => setEditing(null)}
          onSave={async (data) => { await patchProposal(editing.id, data); setEditing(null); }}
        />
      )}
    </div>
  );
}

function EditModal({
  proposal, projects, onClose, onSave,
}: {
  proposal: Proposal;
  projects: { id: string; name: string }[];
  onClose: () => void;
  onSave: (data: Parameters<ReturnType<typeof useApp>['patchProposal']>[1]) => Promise<void>;
}) {
  const [title, setTitle] = useState(proposal.title);
  const isCreateTask = proposal.kind === 'create_task';
  const isUpdateTask = proposal.kind === 'update_task';
  const isCreateProject = proposal.kind === 'create_project';

  const taskPayload = (isCreateTask || isUpdateTask)
    ? (proposal.payload as CreateTaskPayload & UpdateTaskPayload)
    : ({} as CreateTaskPayload & UpdateTaskPayload);
  const projectPayload = isCreateProject ? (proposal.payload as CreateProjectPayload) : null;

  const [projectId, setProjectId] = useState<string>((taskPayload.project_id ?? proposal.target_project_id ?? 'general') as string);
  const [dueDate, setDueDate] = useState<string>(taskPayload.due_date ?? '');
  const [priority, setPriority] = useState<TaskPriority>((taskPayload.priority ?? 'medium'));
  const [projectTasks, setProjectTasks] = useState<string>(projectPayload ? projectPayload.tasks.map((t) => t.title).join('\n') : '');

  const save = async () => {
    if (isCreateTask) {
      const payload: CreateTaskPayload = { ...taskPayload, project_id: projectId, title, due_date: dueDate || null, priority };
      await onSave({ title, payload, target_project_id: projectId });
    } else if (isUpdateTask) {
      const payload: UpdateTaskPayload = { ...taskPayload, title, due_date: dueDate || null, priority };
      await onSave({ title, payload });
    } else if (projectPayload) {
      const tasks = projectTasks.split('\n').map((s) => s.trim()).filter(Boolean)
        .map<CreateTaskPayload>((t) => ({ project_id: '', title: t }));
      const payload: CreateProjectPayload = { ...projectPayload, name: title, tasks };
      await onSave({ title, payload });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-slate-800 mb-4">Edit proposal</h3>

        <label className="block text-xs font-medium text-slate-600 mb-1">Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full border border-slate-300 rounded px-3 py-2 text-sm mb-3" />

        {isCreateTask && (
          <>
            <label className="block text-xs font-medium text-slate-600 mb-1">Project</label>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-full border border-slate-300 rounded px-3 py-2 text-sm mb-3">
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </>
        )}

        {(isCreateTask || isUpdateTask) && (
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Due date</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className="w-full border border-slate-300 rounded px-3 py-2 text-sm">
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="urgent">urgent</option>
              </select>
            </div>
          </div>
        )}

        {isCreateProject && (
          <>
            <label className="block text-xs font-medium text-slate-600 mb-1">Tasks (one per line)</label>
            <textarea value={projectTasks} onChange={(e) => setProjectTasks(e.target.value)} rows={6} className="w-full border border-slate-300 rounded px-3 py-2 text-sm mb-3 font-mono" />
          </>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-sm px-3 py-1.5 rounded border border-slate-300 text-slate-600">Cancel</button>
          <button onClick={save} className="text-sm px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-700">Save</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run verification and commit**
Run: `npm --prefix frontend run build` → Expected: build succeeds with no TS errors.
```bash
git add frontend/src/components/inbox/Inbox.tsx
git commit -m "feat(ui): Inbox proposal review page with edit modal and bulk actions"
```

---

### Task 10: MCP server proposal + briefing tools

**Goal:** Make the MCP client identify as Claude (`X-TM-Actor`) and add `propose_task`, `propose_change`, `propose_project`, `list_proposals`, and `post_briefing` tools alongside the existing ones.

**Files:**
- Modify: `mcp-server/src/index.ts`

**Acceptance Criteria:**
- [ ] Every MCP `api()` request sends header `X-TM-Actor: claude` (merged so caller headers don't clobber it).
- [ ] New tools POST to `/api/proposals` (with dedupe_key/rationale/source/confidence) and `/api/briefing`, and `list_proposals` GETs `/api/proposals`.
- [ ] Existing tools remain unchanged in behavior.
- [ ] `npm --prefix mcp-server run build` (tsc) succeeds.

**Verify:** `npm --prefix mcp-server run build` → exit 0.

**Steps:**

- [ ] **Step 1: Merge the actor header into `api()` (`mcp-server/src/index.ts`)**
```ts
async function api(path: string, options?: RequestInit) {
  const { headers: extraHeaders, ...rest } = options ?? {};
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", "X-TM-Actor": "claude", ...(extraHeaders as Record<string, string> | undefined) },
    ...rest,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}
```

- [ ] **Step 2: Add the proposal + briefing tools** (insert these `server.tool(...)` blocks before the `// --- Start ---` comment; `linkSchema` is already defined above in the file)
```ts
const taskPayloadSchema = {
  project_id: z.string().default("general").describe("Target project ID"),
  title: z.string().describe("Task title"),
  description: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  due_date: z.string().optional().describe("YYYY-MM-DD"),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  links: z.array(linkSchema).optional(),
  doc_type: z.string().optional(),
};

server.tool(
  "propose_task",
  "Propose creating a task for Brice to review in the Inbox (does NOT create it directly). Use for action items from meetings, Slack, or roadmap gaps.",
  {
    ...taskPayloadSchema,
    source: z.enum(["meeting_notes", "slack", "jira_timeline", "roadmap_gap", "manual"]).default("meeting_notes"),
    rationale: z.string().optional().describe("Why you are proposing this"),
    dedupe_key: z.string().optional().describe("Stable key to avoid duplicate proposals, e.g. meeting:<docId>:<itemHash>"),
    confidence: z.enum(["low", "medium", "high"]).optional(),
  },
  async ({ source, rationale, dedupe_key, confidence, project_id, title, description, priority, due_date, status, links, doc_type }) => {
    try {
      const payload = { project_id, title, description, priority, due_date: due_date ?? null, status, links, doc_type };
      const p = await api("/proposals", {
        method: "POST",
        body: JSON.stringify({
          kind: "create_task", source, title, rationale: rationale ?? "",
          dedupe_key: dedupe_key ?? null, target_project_id: project_id, payload, confidence: confidence ?? null,
        }),
      });
      const note = p.skipped ? `(skipped — a declined/applied proposal with that key exists)` : `(${p.status})`;
      return { content: [{ type: "text" as const, text: `Proposed task "${title}" ${note} [${p.id}]` }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  "propose_change",
  "Propose updating an existing task for Brice to review in the Inbox (does NOT apply directly). Use for due-date shifts or status changes.",
  {
    task_id: z.string().describe("Target task ID"),
    project_id: z.string().default("general"),
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(["todo", "in_progress", "done"]).optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    due_date: z.string().optional().describe("YYYY-MM-DD or empty string to clear"),
    links: z.array(linkSchema).optional(),
    doc_type: z.string().optional(),
    source: z.enum(["meeting_notes", "slack", "jira_timeline", "roadmap_gap", "manual"]).default("jira_timeline"),
    rationale: z.string().optional(),
    dedupe_key: z.string().optional().describe("e.g. dateshift:<idea>:<field>:<value>"),
    confidence: z.enum(["low", "medium", "high"]).optional(),
  },
  async ({ task_id, project_id, source, rationale, dedupe_key, confidence, title, description, status, priority, due_date, links, doc_type }) => {
    try {
      const payload: Record<string, any> = {};
      if (title !== undefined) payload.title = title;
      if (description !== undefined) payload.description = description;
      if (status !== undefined) payload.status = status;
      if (priority !== undefined) payload.priority = priority;
      if (due_date !== undefined) payload.due_date = due_date || null;
      if (links !== undefined) payload.links = links;
      if (doc_type !== undefined) payload.doc_type = doc_type;
      const p = await api("/proposals", {
        method: "POST",
        body: JSON.stringify({
          kind: "update_task", source, title: title ?? `Update task ${task_id}`,
          rationale: rationale ?? "", dedupe_key: dedupe_key ?? null,
          target_project_id: project_id, target_task_id: task_id, payload, confidence: confidence ?? null,
        }),
      });
      const note = p.skipped ? `(skipped)` : `(${p.status})`;
      return { content: [{ type: "text" as const, text: `Proposed change to task ${task_id} ${note} [${p.id}]` }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  "propose_project",
  "Propose creating a new project with a set of lifecycle tasks, for Brice to review in the Inbox.",
  {
    name: z.string().describe("Project name"),
    description: z.string().optional(),
    idea_key: z.string().optional().describe("Associated IDEA ticket key, if any"),
    tasks: z.array(z.object({
      title: z.string(),
      description: z.string().optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      due_date: z.string().optional(),
      status: z.enum(["todo", "in_progress", "done"]).optional(),
      doc_type: z.string().optional(),
    })).describe("Lifecycle tasks to seed the project with"),
    source: z.enum(["meeting_notes", "slack", "jira_timeline", "roadmap_gap", "manual"]).default("roadmap_gap"),
    rationale: z.string().optional(),
    dedupe_key: z.string().optional(),
    confidence: z.enum(["low", "medium", "high"]).optional(),
  },
  async ({ name, description, idea_key, tasks, source, rationale, dedupe_key, confidence }) => {
    try {
      const payload = {
        name, description: description ?? "", idea_key: idea_key ?? null,
        tasks: tasks.map((t) => ({ project_id: "", ...t, due_date: t.due_date ?? null })),
      };
      const p = await api("/proposals", {
        method: "POST",
        body: JSON.stringify({
          kind: "create_project", source, title: name, rationale: rationale ?? "",
          dedupe_key: dedupe_key ?? null, payload, confidence: confidence ?? null,
        }),
      });
      const note = p.skipped ? `(skipped)` : `(${p.status})`;
      return { content: [{ type: "text" as const, text: `Proposed project "${name}" with ${tasks.length} task(s) ${note} [${p.id}]` }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  "list_proposals",
  "List proposals in the review Inbox, optionally filtered by status.",
  { status: z.enum(["pending", "approved", "declined", "applied", "superseded"]).optional() },
  async ({ status }) => {
    try {
      const proposals = await api(`/proposals${status ? `?status=${status}` : ""}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(proposals, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  "post_briefing",
  "Store the structured daily briefing sections so they appear on the Today cockpit. Replaces any existing briefing for that date.",
  {
    date: z.string().describe("YYYY-MM-DD"),
    sections: z.object({
      catch_up: z.array(z.string()).optional(),
      must_do: z.array(z.string()).optional(),
      should_do: z.array(z.string()).optional(),
      if_time: z.array(z.string()).optional(),
      stakeholder_updates: z.array(z.string()).optional(),
      data_gaps: z.array(z.string()).optional(),
    }).describe("Briefing sections"),
  },
  async ({ date, sections }) => {
    try {
      const b = await api("/briefing", { method: "POST", body: JSON.stringify({ date, sections }) });
      return { content: [{ type: "text" as const, text: `Posted briefing for ${b.date}` }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }
);
```

- [ ] **Step 3: Run verification and commit**
Run: `npm --prefix mcp-server run build` → Expected: exit 0, no TS errors.
```bash
git add mcp-server/src/index.ts
git commit -m "feat(mcp): actor header + propose_task/propose_change/propose_project/list_proposals/post_briefing"
```

---

### Task 11: Routine SKILL.md — "propose, don't commit" + post_briefing

**Goal:** Change the three routines so autonomous task writes become reviewable proposals and the daily briefing is persisted structurally via `post_briefing`. These files live OUTSIDE the app repo, so this task has no git commit — only edits plus a manual verification checklist.

**Files:**
- Modify: `~/.claude/scheduled-tasks/daily-morning-briefing/SKILL.md`
- Modify: `~/.claude/scheduled-tasks/monday-weekly-planning/SKILL.md`
- Modify: `~/.claude/scheduled-tasks/friday-weekly-review-prep/SKILL.md`

**Acceptance Criteria:**
- [ ] Daily Step 3 uses `propose_task` / `propose_change` (with the specified dedupe keys) instead of `create_task` / `update_task`.
- [ ] Daily Step 6 additionally calls `post_briefing` with the structured sections (in addition to writing the markdown file).
- [ ] Monday and Friday routines describe proposing (not directly creating) any tasks they would write.
- [ ] A note records that the MCP client now sends `X-TM-Actor: claude`.

**Verify:** Manual dry-run — no git commit (files are not tracked in the app repo). `grep -nE "create_task|update_task|propose_task|propose_change|post_briefing" "$HOME/.claude/scheduled-tasks/daily-morning-briefing/SKILL.md"` → shows only `propose_*` / `post_briefing` in the write step, no bare `create_task`/`update_task`.

**Steps:**

- [ ] **Step 1: Rewrite daily Step 3** — replace the whole `## Step 3: Apply the writes (this context only)` section with a `## Step 3: Propose the writes (this context only) — do NOT commit directly` section that: (a) states the MCP client now sends `X-TM-Actor: claude`; (b) for each Agent-C `TASK` item calls `propose_task` with `source: "meeting_notes"`, a `dedupe_key` of `meeting:<docId>:<itemHash>`, a one-line `rationale`, and a `confidence`; (c) still updates `project-timelines.md` for `SHIFTED` projects, but for each recalculated due date calls `propose_change` with `source: "jira_timeline"`, a `dedupe_key` of `dateshift:<idea>:<field>:<value>`, and an old→new `rationale`; (d) never calls `create_task`/`update_task`.

- [ ] **Step 2: Add `post_briefing` to daily Step 6** — after saving the markdown briefing, also call `post_briefing` with `date` = today and `sections` = `{ catch_up, must_do, should_do, if_time, stakeholder_updates, data_gaps }` (each an array of short strings), in addition to (not replacing) the markdown file.

- [ ] **Step 3: Append a "propose, don't commit" note to `monday-weekly-planning/SKILL.md`** Step 9 (Save): implied tasks use `propose_task` with `source: "roadmap_gap"` (or `"manual"`) and a `dedupe_key` like `weekly:<isoWeek>:<slug>`.

- [ ] **Step 4: Append the same note to `friday-weekly-review-prep/SKILL.md`** Step 8 (Save): use `propose_task` with `source: "manual"` and a `dedupe_key` like `review:<isoWeek>:<slug>`.

- [ ] **Step 5: Manual verification (no commit)**
Run: `grep -nE "create_task|update_task|propose_task|propose_change|post_briefing" "$HOME/.claude/scheduled-tasks/daily-morning-briefing/SKILL.md"` → Expected: only `propose_*` / `post_briefing` in the write step. Then eyeball each file's YAML front-matter is intact. Checklist: [ ] daily Step 3 proposes; [ ] daily Step 6 calls post_briefing; [ ] monday note added; [ ] friday note added; [ ] all three front-matters valid.

# Phase 2 — Roadmap as Data + Reconciliation

Tasks 12–15.

### Task 12: `roadmap_items` table, `projects.idea_key`, Phase 2 shared types, and one-time import script

**Goal:** Add the `roadmap_items` mirror table (and a nullable `projects.idea_key`) to the schema and the idempotent migration, append the Phase 2 shared TypeScript types, register the new Drizzle table, and write a one-time seed script that imports the monitored IDEA board from `project-timelines.md`.

**Files:**
- Modify: `backend/src/db/schema.ts`
- Modify: `backend/src/db/index.ts`
- Modify: `backend/src/db/migrate.ts`
- Modify: `shared/types.ts`
- Create: `backend/src/scripts/import-roadmap.ts`
- Test: `backend/src/db/migrate.roadmap.test.ts`
- Test: `backend/src/scripts/import-roadmap.test.ts`

**Acceptance Criteria:**
- [ ] `roadmap_items` exists after migration with `idea_key` PRIMARY KEY and index `idx_roadmap_status`.
- [ ] `projects` has a nullable `idea_key` column (added via PRAGMA `table_info` guard).
- [ ] `shared/types.ts` exports `RoadmapStatus`, `RoadmapItem`, `UpsertRoadmapItemInput`, `ReconcileReport`.
- [ ] `roadmapItems` is registered in the Drizzle `db` schema and `projects` gains `idea_key`.
- [ ] `import-roadmap.ts` seeds exactly 13 `roadmap_items` (4 active, 1 scaffolding, 8 monitored); IDEA-949 has `project_id` null; the four active items carry their real project ids.
- [ ] Both test files pass.

**Verify:** `cd backend && npx vitest run src/db/migrate.roadmap.test.ts src/scripts/import-roadmap.test.ts` → all green. And `cd backend && DB_PATH="$(mktemp -d)/seed.db" npx ts-node src/scripts/import-roadmap.ts` → prints `Seeded 13 roadmap_items (IDEA-949 project_id: null)`.

**Steps:**

- [ ] **Step 1: Append the Phase 2 shared types to `shared/types.ts`**
```ts
// ── Phase 2: Roadmap reconciliation ─────────────────────────────────
export type RoadmapStatus =
  | 'Discover' | 'Roadmap' | 'Plan' | 'Build' | 'Measure' | 'Done'
  | 'On Hold' | "Won't Do" | 'Not Started';

export interface RoadmapItem {
  idea_key: string; name: string; status: RoadmapStatus | string; labels: string[];
  build_start_date: string | null; release_date: string | null; assignee: string | null;
  project_id: string | null; canonical_page_id: string | null; canonical_page_url: string | null;
  canonical_page_status: string | null; canonical_page_updated_at: string | null;
  flags: string[]; notes: string | null; synced_at: string;
}

export interface UpsertRoadmapItemInput {
  idea_key: string; name: string; status: string; labels?: string[];
  build_start_date?: string | null; release_date?: string | null; assignee?: string | null;
  project_id?: string | null; canonical_page_id?: string | null; canonical_page_url?: string | null;
  canonical_page_status?: string | null; canonical_page_updated_at?: string | null;
  notes?: string | null;
}

export interface ReconcileReport {
  orphans: RoadmapItem[];
  unmapped_projects: { id: string; name: string }[];
  date_mismatches: {
    idea_key: string; project_id: string; project_name: string;
    build_start_date: string | null; release_date: string | null;
  }[];
  stale_pages: RoadmapItem[];
}
```

- [ ] **Step 2: Add the Drizzle table + `projects.idea_key` to `backend/src/db/schema.ts`** — add `idea_key: text('idea_key'),` to the `projects` table (after `updated_at`), and append:
```ts
export const roadmapItems = sqliteTable('roadmap_items', {
  idea_key: text('idea_key').primaryKey(),
  name: text('name').notNull(),
  status: text('status').notNull(),
  labels: text('labels').notNull().default('[]'),
  build_start_date: text('build_start_date'),
  release_date: text('release_date'),
  assignee: text('assignee'),
  project_id: text('project_id'),
  canonical_page_id: text('canonical_page_id'),
  canonical_page_url: text('canonical_page_url'),
  canonical_page_status: text('canonical_page_status'),
  canonical_page_updated_at: text('canonical_page_updated_at'),
  flags: text('flags').notNull().default('[]'),
  notes: text('notes'),
  synced_at: text('synced_at').notNull(),
});

export type RoadmapItemRow = typeof roadmapItems.$inferSelect;
```

- [ ] **Step 3: Register the table in `backend/src/db/index.ts`** (cumulative — keep all Phase 1 tables)
```ts
import { projects, tasks, proposals, activity, briefings, roadmapItems } from './schema';
// ...
export const db = drizzle(client, { schema: { projects, tasks, proposals, activity, briefings, roadmapItems } });
```

- [ ] **Step 4: Add DDL + PRAGMA ALTER to `backend/src/db/migrate.ts`** — append inside the `client.executeMultiple(...)` template (after the Phase 1 tables):
```sql
    CREATE TABLE IF NOT EXISTS roadmap_items (
      idea_key TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL,
      labels TEXT NOT NULL DEFAULT '[]', build_start_date TEXT, release_date TEXT, assignee TEXT,
      project_id TEXT, canonical_page_id TEXT, canonical_page_url TEXT,
      canonical_page_status TEXT, canonical_page_updated_at TEXT,
      flags TEXT NOT NULL DEFAULT '[]', notes TEXT, synced_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_roadmap_status ON roadmap_items(status);
```
Then after the existing `tasks` PRAGMA/ALTER block (before the "Ensure General project" insert), add:
```ts
  const projCols = await client.execute(`PRAGMA table_info(projects)`);
  const projColNames = new Set(projCols.rows.map((r: any) => r.name));
  if (!projColNames.has('idea_key')) {
    await client.execute(`ALTER TABLE projects ADD COLUMN idea_key TEXT`);
  }
```

- [ ] **Step 5: Write the migration test `backend/src/db/migrate.roadmap.test.ts`**
```ts
import { describe, it, expect } from 'vitest';
import { client } from './index';

describe('roadmap migration', () => {
  it('creates the roadmap_items table', async () => {
    const res = await client.execute(`SELECT name FROM sqlite_master WHERE type='table' AND name='roadmap_items'`);
    expect(res.rows.length).toBe(1);
  });
  it('creates the idx_roadmap_status index', async () => {
    const res = await client.execute(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_roadmap_status'`);
    expect(res.rows.length).toBe(1);
  });
  it('adds a nullable idea_key column to projects', async () => {
    const res = await client.execute(`PRAGMA table_info(projects)`);
    const names = res.rows.map((r: any) => r.name);
    expect(names).toContain('idea_key');
  });
});
```

- [ ] **Step 6: Write the seed script `backend/src/scripts/import-roadmap.ts`** (values extracted verbatim from `project-timelines.md`)
```ts
import { client } from '../db';
import { runMigrations } from '../db/migrate';
import type { UpsertRoadmapItemInput } from '../../../shared/types';

// One-time seed of the monitored IDEA board, extracted verbatim from
// ~/Claude Assistant/state/project-timelines.md (last checked 2026-09-10).
// The source markdown is free-form prose and is NOT machine-parseable; this
// explicit literal is the honest one-time seed. The routine keeps the mirror
// current afterward via upsert_roadmap_item.
export const roadmapSeed: UpsertRoadmapItemInput[] = [
  { idea_key: 'IDEA-850', name: 'Messaging Center', status: 'Measure', labels: ['OI'],
    build_start_date: '2026-04-15', release_date: '2026-06-04', assignee: null,
    project_id: 'b50cb04d-2827-4200-827f-8e7ecb45969e', canonical_page_id: '4198498306',
    canonical_page_url: 'https://minted.atlassian.net/wiki/pages/resumedraft.action?draftId=4198498306',
    canonical_page_status: 'draft', canonical_page_updated_at: '2026-08-06',
    notes: 'A/B test STOPPED — stat-sig negative (-5.9%). Iterations in progress. OKR 4 impact.' },
  { idea_key: 'IDEA-845', name: 'Registry Enhancements Phase 2', status: 'Measure', labels: ['WW'],
    build_start_date: '2026-04-15', release_date: '2026-07-08', assignee: null,
    project_id: 'b3911fa0-1197-4614-afd6-97075ffc8708', canonical_page_id: '4226482184',
    canonical_page_url: 'https://minted.atlassian.net/wiki/pages/resumedraft.action?draftId=4226482184',
    canonical_page_status: 'draft', canonical_page_updated_at: '2026-08-06',
    notes: 'Reverted Done -> Measure 2026-08-03. 50/50 test ~7/25 for 28 days, trending +4%.' },
  { idea_key: 'IDEA-852', name: 'Updated Dashboard', status: 'Done', labels: ['OI'],
    build_start_date: '2026-06-03', release_date: '2026-06-10', assignee: null,
    project_id: '29426eb7-25df-49e3-bf85-8d62be551998', canonical_page_id: '4225269790',
    canonical_page_url: 'https://minted.atlassian.net/wiki/pages/resumedraft.action?draftId=4225269790',
    canonical_page_status: 'draft', canonical_page_updated_at: '2026-08-06',
    notes: 'Done. Cleanest project on the board (0 overdue).' },
  { idea_key: 'IDEA-932', name: 'WW - Modular Elements (formerly Header / Main Elements Flexibility)',
    status: 'Build', labels: ['WW'], build_start_date: '2026-08-05', release_date: '2026-11-01', assignee: null,
    project_id: '7209aa28-a3c0-4a6b-b161-f301f55085ff', canonical_page_id: '4225335315',
    canonical_page_url: 'https://minted.atlassian.net/wiki/pages/resumedraft.action?draftId=4225335315',
    canonical_page_status: 'draft', canonical_page_updated_at: '2026-08-06',
    notes: '~3 months effort, backend architectural changes. Kickoff contradiction to resolve.' },
  { idea_key: 'IDEA-949', name: 'Navigation - Customize Design/Edit Pages', status: 'Measure', labels: ['WW'],
    build_start_date: '2026-06-24', release_date: '2026-07-28', assignee: null,
    project_id: null, canonical_page_id: null, canonical_page_url: null,
    canonical_page_status: null, canonical_page_updated_at: null,
    notes: 'Needs scaffold-project. Release lapsed 2026-07-28, never re-set. QA materials never sent.' },
  { idea_key: 'IDEA-1030', name: 'OI - Click to edit text and photos', status: 'Discover', labels: ['OI'],
    build_start_date: '2026-08-05', release_date: '2026-09-16', assignee: null,
    project_id: null, canonical_page_id: null, canonical_page_url: null,
    canonical_page_status: null, canonical_page_updated_at: null, notes: 'NEW — not previously tracked.' },
  { idea_key: 'IDEA-849', name: '[Adv Cust] Photo/Video Enhancements', status: 'Roadmap', labels: ['WW'],
    build_start_date: '2026-11-01', release_date: '2026-12-24', assignee: null,
    project_id: null, canonical_page_id: null, canonical_page_url: null,
    canonical_page_status: null, canonical_page_updated_at: null, notes: '~3.5 mo slip (7/20 re-baseline).' },
  { idea_key: 'IDEA-950', name: 'Settings Page Redesign', status: 'Roadmap', labels: ['WW'],
    build_start_date: '2027-02-12', release_date: '2027-03-15', assignee: null,
    project_id: null, canonical_page_id: null, canonical_page_url: null,
    canonical_page_status: null, canonical_page_updated_at: null, notes: '~2 mo slip.' },
  { idea_key: 'IDEA-848', name: '[Adv Cust] UXR Iterations', status: 'Roadmap', labels: ['WW'],
    build_start_date: '2027-01-30', release_date: '2027-02-20', assignee: null,
    project_id: null, canonical_page_id: null, canonical_page_url: null,
    canonical_page_status: null, canonical_page_updated_at: null, notes: '~6 mo slip.' },
  { idea_key: 'IDEA-947', name: 'GM Phase 4 (Event Navigation)', status: 'Not Started', labels: ['WW'],
    build_start_date: '2027-03-11', release_date: '2027-04-21', assignee: null,
    project_id: null, canonical_page_id: null, canonical_page_url: null,
    canonical_page_status: null, canonical_page_updated_at: null, notes: '~5 mo slip.' },
  { idea_key: 'IDEA-826', name: '[Adv Cust] Motifs (Dividers/Crests)', status: 'Roadmap', labels: ['WW'],
    build_start_date: '2027-04-16', release_date: '2027-05-28', assignee: null,
    project_id: null, canonical_page_id: null, canonical_page_url: null,
    canonical_page_status: null, canonical_page_updated_at: null, notes: '~5 mo slip.' },
  { idea_key: 'IDEA-830', name: 'In Line Edits in ABK Core Components', status: 'Discover', labels: ['ABK'],
    build_start_date: '2026-11-17', release_date: '2027-01-05', assignee: null,
    project_id: null, canonical_page_id: null, canonical_page_url: null,
    canonical_page_status: null, canonical_page_updated_at: null, notes: 'Unchanged.' },
  { idea_key: 'IDEA-827', name: 'Update/Merge Contacts in Bulk', status: 'On Hold', labels: ['ABK'],
    build_start_date: '2026-03-03', release_date: '2026-04-27', assignee: null,
    project_id: null, canonical_page_id: null, canonical_page_url: null,
    canonical_page_status: null, canonical_page_updated_at: null, notes: 'Dates lapsed; on hold.' },
];

export async function seedRoadmap(): Promise<number> {
  await runMigrations();
  const ts = new Date().toISOString();
  for (const it of roadmapSeed) {
    await client.execute({
      sql: `INSERT OR REPLACE INTO roadmap_items
        (idea_key, name, status, labels, build_start_date, release_date, assignee,
         project_id, canonical_page_id, canonical_page_url, canonical_page_status,
         canonical_page_updated_at, flags, notes, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
      args: [
        it.idea_key, it.name, it.status, JSON.stringify(it.labels ?? []),
        it.build_start_date ?? null, it.release_date ?? null, it.assignee ?? null,
        it.project_id ?? null, it.canonical_page_id ?? null, it.canonical_page_url ?? null,
        it.canonical_page_status ?? null, it.canonical_page_updated_at ?? null, it.notes ?? null, ts,
      ],
    });
    if (it.project_id) {
      await client.execute({ sql: `UPDATE projects SET idea_key = ? WHERE id = ?`, args: [it.idea_key, it.project_id] });
    }
  }
  const count = await client.execute(`SELECT COUNT(*) AS n FROM roadmap_items`);
  return Number((count.rows[0] as any).n);
}

if (require.main === module) {
  seedRoadmap()
    .then(async (n) => {
      const r = await client.execute(`SELECT project_id FROM roadmap_items WHERE idea_key = 'IDEA-949'`);
      const pid = (r.rows[0] as any)?.project_id ?? null;
      console.log(`Seeded ${n} roadmap_items (IDEA-949 project_id: ${pid})`);
      process.exit(0);
    })
    .catch((e) => { console.error('Seed failed:', e); process.exit(1); });
}
```

- [ ] **Step 7: Write the seed test `backend/src/scripts/import-roadmap.test.ts`**
```ts
import { describe, it, expect } from 'vitest';
import { db } from '../db';
import { roadmapItems, projects } from '../db/schema';
import { eq } from 'drizzle-orm';
import { seedRoadmap, roadmapSeed } from './import-roadmap';

describe('import-roadmap seed', () => {
  it('seeds all monitored IDEA items', async () => {
    const n = await seedRoadmap();
    expect(n).toBe(roadmapSeed.length);
    expect(roadmapSeed.length).toBe(13);
    const rows = await db.select().from(roadmapItems).all();
    expect(rows.length).toBe(13);
  });
  it('leaves IDEA-949 unlinked (needs scaffolding)', async () => {
    await seedRoadmap();
    const row = await db.select().from(roadmapItems).where(eq(roadmapItems.idea_key, 'IDEA-949')).get();
    expect(row?.project_id).toBeNull();
  });
  it('links the four active items to their TaskManager project ids', async () => {
    await seedRoadmap();
    const row = await db.select().from(roadmapItems).where(eq(roadmapItems.idea_key, 'IDEA-850')).get();
    expect(row?.project_id).toBe('b50cb04d-2827-4200-827f-8e7ecb45969e');
    const linked = await db.select().from(projects).where(eq(projects.idea_key, 'IDEA-850')).all();
    expect(Array.isArray(linked)).toBe(true);
  });
});
```

- [ ] **Step 8: Run verification and commit**
```bash
git add backend/src/db/schema.ts backend/src/db/index.ts backend/src/db/migrate.ts shared/types.ts backend/src/scripts/import-roadmap.ts backend/src/db/migrate.roadmap.test.ts backend/src/scripts/import-roadmap.test.ts
git commit -m "feat(roadmap): roadmap_items table + projects.idea_key + Phase 2 types + one-time import"
```

---

### Task 13: Roadmap API — upsert, list with computed flags, and reconcile

**Goal:** Add `backend/src/routes/roadmap.ts` at `/api/roadmap` with upsert-one, list-all (labels/flags parsed, `flags` computed on read, status-ranked, `project_name` attached), and a reconcile report.

**Files:**
- Create: `backend/src/routes/roadmap.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/src/routes/roadmap.test.ts`

**Acceptance Criteria:**
- [ ] `POST /api/roadmap/items` upserts on `idea_key`, stores `labels` as JSON, sets `synced_at`, returns parsed item.
- [ ] `GET /api/roadmap` returns items ordered by status rank then `release_date`, with parsed `labels`/`flags` and `project_name`.
- [ ] `flags` computed on read: `no_project`, `lapsed_release`, `page_stale`, `page_draft`.
- [ ] `GET /api/roadmap/reconcile` returns `ReconcileReport`.
- [ ] All tests pass.

**Verify:** `cd backend && npx vitest run src/routes/roadmap.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Create `backend/src/routes/roadmap.ts`**
```ts
import { Router, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { roadmapItems, projects, tasks } from '../db/schema';
import { actorOf } from '../lib/actor';
import type { UpsertRoadmapItemInput, ReconcileReport, RoadmapItem } from '../../../shared/types';

const router = Router();

function now() { return new Date().toISOString(); }
function today() { return new Date().toISOString().split('T')[0]; }

const ACTIVE_STATUSES = ['Discover', 'Plan', 'Build', 'Measure'];
const CLOSED_STATUSES = ['Done', "Won't Do"];
const STATUS_RANK: Record<string, number> = { Discover: 0, Roadmap: 1, Plan: 2, Build: 3, Measure: 4, Done: 5 };

function computeFlags(row: any, todayStr: string): string[] {
  const flags: string[] = [];
  if (ACTIVE_STATUSES.includes(row.status) && !row.project_id) flags.push('no_project');
  if (row.release_date && row.release_date < todayStr && !CLOSED_STATUSES.includes(row.status)) flags.push('lapsed_release');
  if (row.canonical_page_status === 'draft') flags.push('page_draft');
  if (row.canonical_page_status === 'current' && row.canonical_page_updated_at) {
    const ageDays = (Date.now() - new Date(row.canonical_page_updated_at).getTime()) / 86400000;
    if (ageDays > 14) flags.push('page_stale');
  }
  return flags;
}

function parseItem(row: any, todayStr: string): RoadmapItem {
  return { ...row, labels: JSON.parse(row.labels || '[]'), flags: computeFlags(row, todayStr) };
}

// POST /api/roadmap/items — upsert
router.post('/items', async (req: Request, res: Response) => {
  const input = req.body as UpsertRoadmapItemInput;
  if (!input.idea_key?.trim()) return res.status(400).json({ error: 'idea_key is required' });
  if (!input.name?.trim()) return res.status(400).json({ error: 'name is required' });
  if (!input.status?.trim()) return res.status(400).json({ error: 'status is required' });

  const actor = actorOf(req);
  const ts = now();
  const existing = await db.select().from(roadmapItems).where(eq(roadmapItems.idea_key, input.idea_key)).get();
  const pick = <T>(next: T | undefined, prev: T | null | undefined): T | null =>
    next !== undefined ? next : ((prev ?? null) as T | null);

  const row = {
    idea_key: input.idea_key, name: input.name, status: input.status,
    labels: JSON.stringify(input.labels ?? (existing ? JSON.parse(existing.labels || '[]') : [])),
    build_start_date: pick(input.build_start_date, existing?.build_start_date),
    release_date: pick(input.release_date, existing?.release_date),
    assignee: pick(input.assignee, existing?.assignee),
    project_id: pick(input.project_id, existing?.project_id),
    canonical_page_id: pick(input.canonical_page_id, existing?.canonical_page_id),
    canonical_page_url: pick(input.canonical_page_url, existing?.canonical_page_url),
    canonical_page_status: pick(input.canonical_page_status, existing?.canonical_page_status),
    canonical_page_updated_at: pick(input.canonical_page_updated_at, existing?.canonical_page_updated_at),
    flags: '[]', notes: pick(input.notes, existing?.notes), synced_at: ts,
  };

  if (existing) await db.update(roadmapItems).set(row).where(eq(roadmapItems.idea_key, input.idea_key)).run();
  else await db.insert(roadmapItems).values(row).run();
  console.log(`roadmap upsert ${input.idea_key} by ${actor}`);
  return res.status(existing ? 200 : 201).json(parseItem(row, today()));
});

// GET /api/roadmap
router.get('/', async (_req: Request, res: Response) => {
  const todayStr = today();
  const items = await db.select().from(roadmapItems).all();
  const projRows = await db.select().from(projects).all();
  const projName = new Map(projRows.map((p) => [p.id, p.name]));
  const enriched = items.map((it) => ({
    ...parseItem(it, todayStr),
    project_name: it.project_id ? (projName.get(it.project_id) ?? null) : null,
  }));
  enriched.sort((a, b) => {
    const ra = STATUS_RANK[a.status] ?? 99;
    const rb = STATUS_RANK[b.status] ?? 99;
    if (ra !== rb) return ra - rb;
    return (a.release_date ?? '9999-99-99').localeCompare(b.release_date ?? '9999-99-99');
  });
  return res.json(enriched);
});

// GET /api/roadmap/reconcile
router.get('/reconcile', async (_req: Request, res: Response) => {
  const todayStr = today();
  const items = await db.select().from(roadmapItems).all();
  const projRows = await db.select().from(projects).where(eq(projects.status, 'active')).all();
  const projById = new Map(projRows.map((p) => [p.id, p]));

  const orphans = items.filter((it) => ACTIVE_STATUSES.includes(it.status) && !it.project_id).map((it) => parseItem(it, todayStr));

  const linkedProjectIds = new Set(items.map((i) => i.project_id).filter(Boolean) as string[]);
  const unmapped_projects = projRows
    .filter((p) => !(p as any).idea_key && !linkedProjectIds.has(p.id))
    .map((p) => ({ id: p.id, name: p.name }));

  const date_mismatches: ReconcileReport['date_mismatches'] = [];
  for (const it of items) {
    if (!it.project_id) continue;
    const proj = projById.get(it.project_id);
    if (!proj) continue;
    const projTasks = await db.select().from(tasks).where(eq(tasks.project_id, it.project_id)).all();
    const kick = projTasks.find((t) => /kick off/i.test(t.title));
    const rel = projTasks.find((t) => /release notes/i.test(t.title));
    let mismatch = false;
    if (kick && kick.due_date && it.build_start_date && kick.due_date !== it.build_start_date) mismatch = true;
    if (rel && rel.due_date && it.release_date && rel.due_date !== it.release_date) mismatch = true;
    if (mismatch) {
      date_mismatches.push({
        idea_key: it.idea_key, project_id: it.project_id, project_name: proj.name,
        build_start_date: it.build_start_date, release_date: it.release_date,
      });
    }
  }

  const stale_pages = items.filter((it) => {
    if (it.canonical_page_status === 'draft') return true;
    if (it.canonical_page_status === 'current' && it.canonical_page_updated_at) {
      const ageDays = (Date.now() - new Date(it.canonical_page_updated_at).getTime()) / 86400000;
      return ageDays > 14;
    }
    return false;
  }).map((it) => parseItem(it, todayStr));

  const report: ReconcileReport = { orphans, unmapped_projects, date_mismatches, stale_pages };
  return res.json(report);
});

export default router;
```

- [ ] **Step 2: Mount in `backend/src/index.ts`** — add `import roadmapRouter from './routes/roadmap';` and `app.use('/api/roadmap', roadmapRouter);`.

- [ ] **Step 3: Write tests `backend/src/routes/roadmap.test.ts`**
```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../index';
import { db } from '../db';
import { projects, tasks } from '../db/schema';

function iso(offsetDays: number): string {
  const d = new Date(); d.setDate(d.getDate() + offsetDays); return d.toISOString().split('T')[0];
}

describe('roadmap API', () => {
  it('upserts an item then lists it with parsed labels', async () => {
    const post = await request(app).post('/api/roadmap/items').send({
      idea_key: 'IDEA-1', name: 'Thing', status: 'Build', labels: ['WW'],
      build_start_date: '2026-08-05', release_date: '2026-11-01',
    });
    expect(post.status).toBe(201);
    expect(post.body.labels).toEqual(['WW']);
    const put = await request(app).post('/api/roadmap/items').send({ idea_key: 'IDEA-1', name: 'Thing (renamed)', status: 'Measure' });
    expect(put.status).toBe(200);
    expect(put.body.name).toBe('Thing (renamed)');
    expect(put.body.labels).toEqual(['WW']);
    const list = await request(app).get('/api/roadmap');
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(1);
    expect(list.body[0].idea_key).toBe('IDEA-1');
  });

  it('rejects an item with no idea_key', async () => {
    const res = await request(app).post('/api/roadmap/items').send({ name: 'x', status: 'Build' });
    expect(res.status).toBe(400);
  });

  it('computes no_project for a Build item with no project', async () => {
    await request(app).post('/api/roadmap/items').send({ idea_key: 'IDEA-2', name: 'Orphan', status: 'Build', build_start_date: iso(-10), release_date: iso(30) });
    const list = await request(app).get('/api/roadmap');
    const item = list.body.find((i: any) => i.idea_key === 'IDEA-2');
    expect(item.flags).toContain('no_project');
  });

  it('computes lapsed_release and page flags', async () => {
    await request(app).post('/api/roadmap/items').send({ idea_key: 'IDEA-3', name: 'Lapsed', status: 'Measure', release_date: iso(-5), canonical_page_status: 'draft' });
    const list = await request(app).get('/api/roadmap');
    const item = list.body.find((i: any) => i.idea_key === 'IDEA-3');
    expect(item.flags).toContain('lapsed_release');
    expect(item.flags).toContain('page_draft');
  });

  it('does not flag lapsed_release for a Done item', async () => {
    await request(app).post('/api/roadmap/items').send({ idea_key: 'IDEA-4', name: 'Shipped', status: 'Done', release_date: iso(-30) });
    const list = await request(app).get('/api/roadmap');
    const item = list.body.find((i: any) => i.idea_key === 'IDEA-4');
    expect(item.flags).not.toContain('lapsed_release');
  });

  it('orders items by status rank then release date', async () => {
    await request(app).post('/api/roadmap/items').send({ idea_key: 'A', name: 'a', status: 'Measure' });
    await request(app).post('/api/roadmap/items').send({ idea_key: 'B', name: 'b', status: 'Discover' });
    await request(app).post('/api/roadmap/items').send({ idea_key: 'C', name: 'c', status: 'Build' });
    const list = await request(app).get('/api/roadmap');
    expect(list.body.map((i: any) => i.status)).toEqual(['Discover', 'Build', 'Measure']);
  });

  it('reconcile reports orphans, unmapped projects, date mismatches, and stale pages', async () => {
    await request(app).post('/api/roadmap/items').send({ idea_key: 'IDEA-ORPHAN', name: 'Needs scaffold', status: 'Build', release_date: iso(-2) });
    await db.insert(projects).values({
      id: 'proj-linked', name: 'Linked Project', description: '', status: 'active',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), idea_key: 'IDEA-LINK',
    }).run();
    await db.insert(tasks).values({
      id: 'task-kick', project_id: 'proj-linked', title: 'Kick off with engineering',
      description: '', status: 'todo', priority: 'high', due_date: '2026-08-01', position: 0,
      images: '[]', links: '[]', doc_type: null, source: 'manual', slack_raw: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).run();
    await request(app).post('/api/roadmap/items').send({
      idea_key: 'IDEA-LINK', name: 'Linked', status: 'Build',
      project_id: 'proj-linked', build_start_date: '2026-08-05', canonical_page_status: 'draft',
    });
    await db.insert(projects).values({
      id: 'proj-unmapped', name: 'Unmapped Project', description: '', status: 'active',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), idea_key: null,
    }).run();

    const res = await request(app).get('/api/roadmap/reconcile');
    expect(res.status).toBe(200);
    expect(res.body.orphans.map((o: any) => o.idea_key)).toContain('IDEA-ORPHAN');
    expect(res.body.unmapped_projects.map((p: any) => p.id)).toContain('proj-unmapped');
    expect(res.body.unmapped_projects.map((p: any) => p.id)).toContain('general');
    expect(res.body.date_mismatches.map((d: any) => d.idea_key)).toContain('IDEA-LINK');
    expect(res.body.stale_pages.map((s: any) => s.idea_key)).toContain('IDEA-LINK');
  });
});
```

- [ ] **Step 4: Run verification and commit**
```bash
git add backend/src/routes/roadmap.ts backend/src/index.ts backend/src/routes/roadmap.test.ts
git commit -m "feat(api): roadmap upsert/list/reconcile with computed flags"
```

---

### Task 14: MCP roadmap tools

**Goal:** Add `upsert_roadmap_item`, `list_roadmap`, `get_reconciliation` to `mcp-server/src/index.ts` (reusing `api()`, which already sends `X-TM-Actor: claude`).

**Files:**
- Modify: `mcp-server/src/index.ts`

**Acceptance Criteria:**
- [ ] `upsert_roadmap_item` POSTs to `/roadmap/items`; `list_roadmap` GETs `/roadmap`; `get_reconciliation` GETs `/roadmap/reconcile`.
- [ ] `npm --prefix mcp-server run build` succeeds.

**Verify:** `npm --prefix mcp-server run build` → exit 0.

**Steps:**

- [ ] **Step 1: Add the three tools before `// --- Start ---`**
```ts
server.tool(
  "upsert_roadmap_item",
  "Upsert one monitored IDEA-board item into the roadmap mirror. The routine calls this to keep TaskManager's roadmap current instead of editing project-timelines.md. Omitted optional fields are preserved from the existing row.",
  {
    idea_key: z.string().describe("IDEA key, e.g. 'IDEA-850' (primary key)"),
    name: z.string().describe("Item name / summary"),
    status: z.string().describe("Board status: Discover | Roadmap | Plan | Build | Measure | Done | On Hold | Won't Do | Not Started"),
    labels: z.array(z.string()).optional(),
    build_start_date: z.string().nullable().optional(),
    release_date: z.string().nullable().optional(),
    assignee: z.string().nullable().optional(),
    project_id: z.string().nullable().optional(),
    canonical_page_id: z.string().nullable().optional(),
    canonical_page_url: z.string().nullable().optional(),
    canonical_page_status: z.string().nullable().optional(),
    canonical_page_updated_at: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  },
  async (args) => {
    try {
      const item = await api("/roadmap/items", { method: "POST", body: JSON.stringify(args) });
      return { content: [{ type: "text" as const, text: `Upserted ${item.idea_key} (${item.status})\nFlags: ${(item.flags || []).join(", ") || "none"}` }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  "list_roadmap",
  "List all roadmap items, ordered by board status then release date, each with computed flags (no_project / lapsed_release / page_stale / page_draft) and linked project_name.",
  {},
  async () => {
    try {
      const items = await api("/roadmap");
      return { content: [{ type: "text" as const, text: JSON.stringify(items, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  "get_reconciliation",
  "Get the IDEA<->TaskManager reconciliation report: orphan IDEA items with no project, TaskManager projects not on the roadmap, project lifecycle dates that disagree with the item, and stale/draft canonical pages.",
  {},
  async () => {
    try {
      const report = await api("/roadmap/reconcile");
      return { content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }
);
```

- [ ] **Step 2: Run verification and commit**
```bash
git add mcp-server/src/index.ts
git commit -m "feat(mcp): upsert_roadmap_item, list_roadmap, get_reconciliation tools"
```

---

### Task 15: Frontend Roadmap reconciliation view with Scaffold → proposal

**Goal:** Add `/roadmap` showing items grouped by status and a Reconciliation panel (orphans with Scaffold, unmapped projects, date mismatches, stale pages). Scaffold POSTs a `create_project` proposal built from the due-date calc rules.

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/context/AppContext.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`
- Create: `frontend/src/components/roadmap/Roadmap.tsx`

**Acceptance Criteria:**
- [ ] `/roadmap` renders grouped items + a reconciliation panel with the four sections.
- [ ] Each orphan has a Scaffold button POSTing a `create_project` proposal (`dedupe_key: scaffold:<idea_key>`, payload with `name`, `idea_key`, and a `tasks` array from build_start/release; empty `tasks` when a date is missing).
- [ ] Client exposes `getRoadmap`, `getReconciliation`, `scaffoldProposal`; context exposes `loadRoadmap`, `loadReconciliation`, `scaffold`.
- [ ] Sidebar has a Roadmap link; `App.tsx` has the `/roadmap` route.
- [ ] `npm --prefix frontend run build` succeeds.

**Verify:** `npm --prefix frontend run build` → exit 0.

**Steps:**

- [ ] **Step 1: Add client methods to `frontend/src/api/client.ts`** (after `getUpcoming`)
```ts
  // Roadmap (Phase 2)
  getRoadmap: () =>
    request<(import('@shared/types').RoadmapItem & { project_name: string | null })[]>('/roadmap'),
  getReconciliation: () =>
    request<import('@shared/types').ReconcileReport>('/roadmap/reconcile'),
  scaffoldProposal: (input: {
    idea_key: string; name: string; build_start_date: string | null; release_date: string | null;
    tasks: { title: string; due_date: string | null; priority: string; description?: string; doc_type?: string | null }[];
  }) =>
    request<{ id: string }>('/proposals', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'create_project', source: 'roadmap_gap', dedupe_key: `scaffold:${input.idea_key}`,
        title: `Scaffold project for ${input.idea_key} — ${input.name}`,
        rationale: `Roadmap item ${input.idea_key} is in an active state with no linked TaskManager project.`,
        payload: { name: input.name, description: '', idea_key: input.idea_key, tasks: input.tasks },
      }),
    }),
```

- [ ] **Step 2: Wire the context in `frontend/src/context/AppContext.tsx`**
  1. Extend the type import: add `RoadmapItem, ReconcileReport` to the `@shared/types` import.
  2. Add to `AppState`: `roadmap: (RoadmapItem & { project_name: string | null })[];` and `reconciliation: ReconcileReport | null;`
  3. Add to `Action`: `| { type: 'SET_ROADMAP'; payload: (RoadmapItem & { project_name: string | null })[] }` and `| { type: 'SET_RECONCILIATION'; payload: ReconcileReport }`.
  4. Add reducer cases: `case 'SET_ROADMAP': return { ...state, roadmap: action.payload };` and `case 'SET_RECONCILIATION': return { ...state, reconciliation: action.payload };`
  5. Add to `initialState`: `roadmap: [], reconciliation: null,`
  6. Add to `AppContextValue`: `loadRoadmap`, `loadReconciliation`, and `scaffold: (input: Parameters<typeof api.scaffoldProposal>[0]) => Promise<void>;`
  7. Add implementations inside `AppProvider`:
```ts
  const loadRoadmap = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const roadmap = await api.getRoadmap();
      dispatch({ type: 'SET_ROADMAP', payload: roadmap });
    } catch (e) { dispatch({ type: 'SET_ERROR', payload: (e as Error).message }); }
    finally { dispatch({ type: 'SET_LOADING', payload: false }); }
  }, []);

  const loadReconciliation = useCallback(async () => {
    try {
      const report = await api.getReconciliation();
      dispatch({ type: 'SET_RECONCILIATION', payload: report });
    } catch (e) { dispatch({ type: 'SET_ERROR', payload: (e as Error).message }); }
  }, []);

  const scaffold = useCallback(async (input: Parameters<typeof api.scaffoldProposal>[0]) => {
    try { await api.scaffoldProposal(input); }
    catch (e) { dispatch({ type: 'SET_ERROR', payload: (e as Error).message }); }
  }, []);
```
  8. Add `loadRoadmap, loadReconciliation, scaffold` to the provider `value` object.

- [ ] **Step 3: Create `frontend/src/components/roadmap/Roadmap.tsx`**
```tsx
import { useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import type { RoadmapItem } from '@shared/types';

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().split('T')[0];
}
function addBusinessDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  let added = 0; const dir = n >= 0 ? 1 : -1;
  while (added < Math.abs(n)) {
    d.setUTCDate(d.getUTCDate() + dir);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toISOString().split('T')[0];
}

type LifecycleTask = { title: string; due_date: string | null; priority: string; doc_type?: string | null };

export function buildLifecycleTasks(bs: string | null, rd: string | null): LifecycleTask[] {
  if (!bs || !rd) return [];
  const midOffset = Math.floor((Date.parse(rd) - Date.parse(bs)) / 86400000 / 2);
  const mid = addDays(bs, Math.max(midOffset, 0));
  return [
    { title: 'Eng scoping / tech design review', due_date: addBusinessDays(bs, -5), priority: 'high' },
    { title: 'UX design review and sign-off', due_date: addBusinessDays(bs, -1), priority: 'high' },
    { title: 'Kick off with engineering', due_date: bs, priority: 'high' },
    { title: 'Mid-build check-in', due_date: mid, priority: 'medium' },
    { title: 'QA review', due_date: addBusinessDays(rd, -3), priority: 'high' },
    { title: 'Share with CS / Marketing', due_date: addBusinessDays(rd, -5), priority: 'medium' },
    { title: 'Release notes', due_date: rd, priority: 'high', doc_type: 'release_notes' },
    { title: 'Post results / metrics check', due_date: addDays(rd, 14), priority: 'medium', doc_type: 'metrics_snapshot' },
    { title: 'Final readout / decision record', due_date: addDays(rd, 21), priority: 'medium' },
    { title: 'Retro', due_date: addDays(rd, 25), priority: 'low' },
  ];
}

const STATUS_ORDER = ['Discover', 'Roadmap', 'Plan', 'Build', 'Measure', 'Done'];
const FLAG_LABEL: Record<string, string> = {
  no_project: 'No project', lapsed_release: 'Release lapsed', page_stale: 'Page stale', page_draft: 'Page draft',
};

function FlagChip({ flag }: { flag: string }) {
  return <span className="text-xs bg-amber-100 text-amber-800 rounded-full px-2 py-0.5">{FLAG_LABEL[flag] ?? flag}</span>;
}

export function Roadmap() {
  const { state, loadRoadmap, loadReconciliation, scaffold } = useApp();
  const { roadmap, reconciliation } = state;

  useEffect(() => { loadRoadmap(); loadReconciliation(); }, [loadRoadmap, loadReconciliation]);

  const handleScaffold = async (item: RoadmapItem) => {
    await scaffold({
      idea_key: item.idea_key, name: item.name,
      build_start_date: item.build_start_date, release_date: item.release_date,
      tasks: buildLifecycleTasks(item.build_start_date, item.release_date),
    });
    await loadReconciliation();
  };

  const grouped = STATUS_ORDER.map((status) => ({ status, items: roadmap.filter((i) => i.status === status) })).filter((g) => g.items.length > 0);
  const other = roadmap.filter((i) => !STATUS_ORDER.includes(i.status));

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold text-slate-800 mb-6">Roadmap</h2>

      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-8">
        <h3 className="font-semibold text-slate-700 mb-4">Reconciliation</h3>
        {!reconciliation ? (
          <p className="text-sm text-slate-500">Loading reconciliation…</p>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            <section>
              <h4 className="text-sm font-semibold text-slate-600 mb-2">Orphans — active IDEA, no project ({reconciliation.orphans.length})</h4>
              {reconciliation.orphans.length === 0 ? <p className="text-xs text-slate-400">None.</p> : (
                <ul className="space-y-2">
                  {reconciliation.orphans.map((o) => (
                    <li key={o.idea_key} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate"><span className="font-mono text-xs text-slate-500">{o.idea_key}</span> {o.name}</span>
                      <button onClick={() => handleScaffold(o)} className="flex-shrink-0 bg-indigo-600 text-white text-xs px-2.5 py-1 rounded-md hover:bg-indigo-700">Scaffold</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h4 className="text-sm font-semibold text-slate-600 mb-2">Not on roadmap — projects with no IDEA link ({reconciliation.unmapped_projects.length})</h4>
              {reconciliation.unmapped_projects.length === 0 ? <p className="text-xs text-slate-400">None.</p> : (
                <ul className="space-y-1 text-sm">
                  {reconciliation.unmapped_projects.map((p) => <li key={p.id} className="truncate text-slate-700">{p.name}</li>)}
                </ul>
              )}
            </section>
            <section>
              <h4 className="text-sm font-semibold text-slate-600 mb-2">Date mismatches ({reconciliation.date_mismatches.length})</h4>
              {reconciliation.date_mismatches.length === 0 ? <p className="text-xs text-slate-400">None.</p> : (
                <ul className="space-y-1 text-sm">
                  {reconciliation.date_mismatches.map((d) => (
                    <li key={d.idea_key} className="text-slate-700">
                      <span className="font-mono text-xs text-slate-500">{d.idea_key}</span> {d.project_name}
                      <span className="text-xs text-slate-400 block">BS {d.build_start_date ?? '—'} · RD {d.release_date ?? '—'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h4 className="text-sm font-semibold text-slate-600 mb-2">Stale / draft pages ({reconciliation.stale_pages.length})</h4>
              {reconciliation.stale_pages.length === 0 ? <p className="text-xs text-slate-400">None.</p> : (
                <ul className="space-y-1 text-sm">
                  {reconciliation.stale_pages.map((s) => (
                    <li key={s.idea_key} className="text-slate-700">
                      <span className="font-mono text-xs text-slate-500">{s.idea_key}</span> {s.name}
                      <span className="text-xs text-slate-400"> ({s.canonical_page_status ?? 'no page'})</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>

      {roadmap.length === 0 ? (
        <p className="text-slate-500">No roadmap items yet.</p>
      ) : (
        <div className="space-y-6">
          {[...grouped, ...(other.length ? [{ status: 'Other', items: other }] : [])].map((group) => (
            <div key={group.status}>
              <h3 className="font-semibold text-slate-700 mb-3">{group.status}</h3>
              <div className="space-y-2">
                {group.items.map((item) => (
                  <div key={item.idea_key} className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between gap-3 mb-1">
                      <span className="font-medium text-slate-800 truncate">
                        <span className="font-mono text-xs text-slate-500 mr-2">{item.idea_key}</span>{item.name}
                      </span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {item.flags.map((f) => <FlagChip key={f} flag={f} />)}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                      <span>Build start: {item.build_start_date ?? '—'}</span>
                      <span>Release: {item.release_date ?? '—'}</span>
                      <span>Project: {item.project_id ? (item.project_name ?? item.project_id) : <span className="text-amber-700">unscaffolded</span>}</span>
                      {item.labels.length > 0 && <span>Labels: {item.labels.join(', ')}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add the route to `frontend/src/App.tsx`** — `import { Roadmap } from './components/roadmap/Roadmap';` and `<Route path="/roadmap" element={<Roadmap />} />` inside the `<Layout>` route.

- [ ] **Step 5: Add the Sidebar link** — inside the Task-8 nav group (`<div className="px-3 mb-2 space-y-1">`), after the Dashboard `<Link>`:
```tsx
          <Link
            to="/roadmap"
            className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              location.pathname.startsWith('/roadmap') ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            Roadmap
          </Link>
```

- [ ] **Step 6: Run verification and commit**
```bash
git add frontend/src/api/client.ts frontend/src/context/AppContext.tsx frontend/src/App.tsx frontend/src/components/layout/Sidebar.tsx frontend/src/components/roadmap/Roadmap.tsx
git commit -m "feat(ui): roadmap reconciliation view + scaffold-to-proposal"
```

# Phase 3 — Outbox Write-Back

Tasks 16–19.

### Task 16: Outbox table, Phase 3 shared types, Drizzle registration, migration test

**Goal:** Add the `outbox` table (the control-plane's queue of external-write intents) to the schema, migration, and Drizzle registration; append the Phase 3 shared types and the optional `outbox?` field on the proposal payload interfaces. Storage only — the backend never calls an external system.

**Files:**
- Modify: `backend/src/db/migrate.ts`
- Modify: `backend/src/db/schema.ts`
- Modify: `backend/src/db/index.ts`
- Modify: `shared/types.ts`
- Create (test): `backend/src/db/outbox.migrate.test.ts`

**Acceptance Criteria:**
- [ ] `outbox` created idempotently with the canonical columns and `idx_outbox_status`.
- [ ] `outbox` exported from `schema.ts` and registered in `db/index.ts` (cumulative with all prior tables).
- [ ] `shared/types.ts` gains `OutboxKind`, `OutboxStatus`, `OutboxItem`, `EnqueueOutboxInput`, `CompleteOutboxInput`, and `outbox?: EnqueueOutboxInput[]` on the three payload interfaces.
- [ ] Migration test passes.

**Verify:** `npm --prefix backend test src/db/outbox.migrate.test.ts` → 2 passed.

**Steps:**

- [ ] **Step 1: Write the failing test `backend/src/db/outbox.migrate.test.ts`**
```ts
import { describe, it, expect } from 'vitest';
import { client } from './index';

describe('outbox migration', () => {
  it('creates the outbox table with the expected columns', async () => {
    const info = await client.execute(`PRAGMA table_info(outbox)`);
    const cols = new Set(info.rows.map((r: any) => r.name));
    for (const c of ['id','created_at','kind','status','target','payload','origin_proposal_id','origin_task_id','attempts','last_error','pushed_at']) {
      expect(cols.has(c)).toBe(true);
    }
  });
  it('creates the idx_outbox_status index', async () => {
    const idx = await client.execute(`PRAGMA index_list(outbox)`);
    expect(idx.rows.map((r: any) => r.name)).toContain('idx_outbox_status');
  });
});
```

- [ ] **Step 2: Add DDL to `backend/src/db/migrate.ts`** (append inside the `client.executeMultiple(...)` template, after the Phase 2 tables)
```sql
    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', target TEXT NOT NULL DEFAULT '{}',
      payload TEXT NOT NULL DEFAULT '{}', origin_proposal_id TEXT, origin_task_id TEXT,
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, pushed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status);
```

- [ ] **Step 3: Add the Drizzle def to `backend/src/db/schema.ts`**
```ts
export const outbox = sqliteTable('outbox', {
  id: text('id').primaryKey(),
  created_at: text('created_at').notNull(),
  kind: text('kind').notNull(),
  status: text('status').notNull().default('pending'),
  target: text('target').notNull().default('{}'),
  payload: text('payload').notNull().default('{}'),
  origin_proposal_id: text('origin_proposal_id'),
  origin_task_id: text('origin_task_id'),
  attempts: integer('attempts').notNull().default(0),
  last_error: text('last_error'),
  pushed_at: text('pushed_at'),
});

export type OutboxRow = typeof outbox.$inferSelect;
```

- [ ] **Step 4: Register in `backend/src/db/index.ts`** (cumulative — the final, complete registration)
```ts
import { projects, tasks, proposals, activity, briefings, roadmapItems, outbox } from './schema';
// ...
export const db = drizzle(client, { schema: { projects, tasks, proposals, activity, briefings, roadmapItems, outbox } });
```

- [ ] **Step 5: Append the Phase 3 block to `shared/types.ts`**
```ts
// ── Phase 3: Outbox (external write-back intents) ───────────────────
export type OutboxKind = 'jira_update_dates' | 'confluence_refresh_page' | 'jira_transition' | 'jpd_note';
export type OutboxStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped';
export interface OutboxItem {
  id: string; created_at: string; kind: OutboxKind | string; status: OutboxStatus;
  target: Record<string, unknown>; payload: Record<string, unknown>;
  origin_proposal_id: string | null; origin_task_id: string | null;
  attempts: number; last_error: string | null; pushed_at: string | null;
}
export interface EnqueueOutboxInput {
  kind: OutboxKind | string; target: Record<string, unknown>; payload?: Record<string, unknown>;
  origin_proposal_id?: string | null; origin_task_id?: string | null;
}
export interface CompleteOutboxInput { status: 'done' | 'failed' | 'skipped'; last_error?: string | null; }
```

- [ ] **Step 6: Add `outbox?` to the Phase 1 payload interfaces in `shared/types.ts`** — add the line `outbox?: EnqueueOutboxInput[];` to each of `CreateTaskPayload`, `UpdateTaskPayload`, and `CreateProjectPayload` (TypeScript resolves the forward reference to `EnqueueOutboxInput` within the module). This is what lets an approved proposal carry external-write intents.

- [ ] **Step 7: Run verification and commit**
Run: `npm --prefix backend test src/db/outbox.migrate.test.ts` → Expected: 2 passed.
```bash
git add backend/src/db/migrate.ts backend/src/db/schema.ts backend/src/db/index.ts shared/types.ts backend/src/db/outbox.migrate.test.ts
git commit -m "feat(db): add outbox table + Phase 3 types + migration test"
```

---

### Task 17: Outbox API (enqueue/list/patch/retry) + enqueue-on-approve + Vitest coverage

**Goal:** Add `/api/outbox` (enqueue, list, result-reporting PATCH, retry) and wire the proposals approve handler to enqueue any `payload.outbox` intents. The backend stays dumb — it enqueues exactly what the proposal specifies and never performs the external write.

**Files:**
- Create: `backend/src/routes/outbox.ts`
- Modify: `backend/src/index.ts`
- Modify: `backend/src/routes/proposals.ts`
- Create (test): `backend/src/routes/outbox.test.ts`

**Acceptance Criteria:**
- [ ] `POST /api/outbox` enqueues (201, `pending`, `attempts:0`, parsed target/payload, `pushed_at:null`); missing `kind` → 400.
- [ ] `GET /api/outbox?status=pending` returns pending newest-first with parsed target/payload; no status → all.
- [ ] `PATCH /api/outbox/:id` `{status:'done'}` sets `pushed_at`, increments `attempts`, logs a `pushed_to_external` activity; `{status:'failed', last_error}` records `last_error`, increments `attempts`, leaves `pushed_at` null; missing → 404.
- [ ] `POST /api/outbox/:id/retry` resets a `failed` item to `pending` and clears `last_error`; non-failed → 400; missing → 404.
- [ ] Approving a proposal whose payload carries `outbox:[...]` enqueues each with `origin_proposal_id` set.

**Verify:** `npm --prefix backend test src/routes/outbox.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write tests `backend/src/routes/outbox.test.ts`**
```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../index';

describe('outbox API', () => {
  it('enqueues an item as pending with parsed target/payload', async () => {
    const res = await request(app).post('/api/outbox').send({
      kind: 'jira_update_dates', target: { idea_key: 'IDEA-850' },
      payload: { fields: { build_start_date: '2026-10-01' } },
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.attempts).toBe(0);
    expect(res.body.target).toEqual({ idea_key: 'IDEA-850' });
    expect(res.body.payload).toEqual({ fields: { build_start_date: '2026-10-01' } });
    expect(res.body.pushed_at).toBeNull();
  });

  it('rejects enqueue without a kind', async () => {
    const res = await request(app).post('/api/outbox').send({ target: {} });
    expect(res.status).toBe(400);
  });

  it('lists only pending items when filtered', async () => {
    const a = await request(app).post('/api/outbox').send({ kind: 'jira_update_dates', target: {} });
    const b = await request(app).post('/api/outbox').send({ kind: 'confluence_refresh_page', target: {} });
    await request(app).patch(`/api/outbox/${b.body.id}`).send({ status: 'done' });
    const res = await request(app).get('/api/outbox?status=pending');
    const ids = res.body.map((r: any) => r.id);
    expect(ids).toContain(a.body.id);
    expect(ids).not.toContain(b.body.id);
  });

  it('patch → done sets pushed_at, increments attempts, and logs activity', async () => {
    const item = await request(app).post('/api/outbox').send({ kind: 'jira_update_dates', target: {}, origin_task_id: null });
    const res = await request(app).patch(`/api/outbox/${item.body.id}`).send({ status: 'done' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done');
    expect(res.body.attempts).toBe(1);
    expect(res.body.pushed_at).not.toBeNull();
    const activity = await request(app).get('/api/activity?limit=50');
    const events = activity.body.map((a: any) => a.type);
    expect(events).toContain('pushed_to_external');
  });

  it('patch → failed records last_error and increments attempts, no pushed_at', async () => {
    const item = await request(app).post('/api/outbox').send({ kind: 'jira_transition', target: {} });
    const res = await request(app).patch(`/api/outbox/${item.body.id}`).send({ status: 'failed', last_error: 'Atlassian 409 conflict' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('failed');
    expect(res.body.last_error).toBe('Atlassian 409 conflict');
    expect(res.body.attempts).toBe(1);
    expect(res.body.pushed_at).toBeNull();
  });

  it('patch on a missing item is 404', async () => {
    const res = await request(app).patch('/api/outbox/does-not-exist').send({ status: 'done' });
    expect(res.status).toBe(404);
  });

  it('retry resets a failed item to pending and clears last_error', async () => {
    const item = await request(app).post('/api/outbox').send({ kind: 'jira_update_dates', target: {} });
    await request(app).patch(`/api/outbox/${item.body.id}`).send({ status: 'failed', last_error: 'boom' });
    const res = await request(app).post(`/api/outbox/${item.body.id}/retry`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
    expect(res.body.last_error).toBeNull();
  });

  it('retry on a non-failed item is 400', async () => {
    const item = await request(app).post('/api/outbox').send({ kind: 'jira_update_dates', target: {} });
    const res = await request(app).post(`/api/outbox/${item.body.id}/retry`);
    expect(res.status).toBe(400);
  });

  it('approving a proposal carrying payload.outbox enqueues those intents', async () => {
    const project = await request(app).post('/api/projects').send({ name: 'Outbox Proj' });
    const task = await request(app).post(`/api/projects/${project.body.id}/tasks`).send({ title: 'Ship it', due_date: '2026-10-01' });
    const proposal = await request(app).post('/api/proposals').send({
      kind: 'update_task', dedupe_key: 'outbox-approve-test', source: 'jira_timeline',
      rationale: 'Release date shifted; propagate to Jira on approve.',
      target_project_id: project.body.id, target_task_id: task.body.id,
      payload: {
        due_date: '2026-10-08',
        outbox: [{ kind: 'jira_update_dates', target: { idea_key: 'IDEA-850' }, payload: { fields: { release_date: '2026-10-08' } }, origin_task_id: task.body.id }],
      },
    });
    expect(proposal.status).toBe(201);
    const approve = await request(app).post(`/api/proposals/${proposal.body.id}/approve`);
    expect(approve.status).toBe(200);
    const pending = await request(app).get('/api/outbox?status=pending');
    const mine = pending.body.filter((r: any) => r.origin_proposal_id === proposal.body.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].kind).toBe('jira_update_dates');
    expect(mine[0].origin_task_id).toBe(task.body.id);
  });
});
```

- [ ] **Step 2: Create `backend/src/routes/outbox.ts`** (note: `logActivity` uses `type:`, per the shared helper)
```ts
import { Router, Request, Response } from 'express';
import { eq, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import { outbox } from '../db/schema';
import { actorOf } from '../lib/actor';
import { logActivity } from '../lib/activity';
import type { EnqueueOutboxInput, CompleteOutboxInput } from '../../../shared/types';

const router = Router();

function now() { return new Date().toISOString(); }
function parseRow(row: any) {
  if (!row) return row;
  return { ...row, target: JSON.parse(row.target || '{}'), payload: JSON.parse(row.payload || '{}') };
}

// POST /api/outbox
router.post('/', async (req: Request, res: Response) => {
  const { kind, target = {}, payload = {}, origin_proposal_id = null, origin_task_id = null }: EnqueueOutboxInput = req.body;
  if (!kind || typeof kind !== 'string') return res.status(400).json({ error: 'kind is required' });
  const row = {
    id: uuidv4(), created_at: now(), kind, status: 'pending' as const,
    target: JSON.stringify(target ?? {}), payload: JSON.stringify(payload ?? {}),
    origin_proposal_id: origin_proposal_id ?? null, origin_task_id: origin_task_id ?? null,
    attempts: 0, last_error: null as string | null, pushed_at: null as string | null,
  };
  await db.insert(outbox).values(row).run();
  return res.status(201).json(parseRow(row));
});

// GET /api/outbox?status=pending
router.get('/', async (req: Request, res: Response) => {
  let rows = await db.select().from(outbox).orderBy(desc(outbox.created_at)).all();
  const status = req.query.status;
  if (typeof status === 'string' && status.length > 0) rows = rows.filter((r) => r.status === status);
  return res.json(rows.map(parseRow));
});

// PATCH /api/outbox/:id
router.patch('/:id', async (req: Request, res: Response) => {
  const row = await db.select().from(outbox).where(eq(outbox.id, req.params.id)).get();
  if (!row) return res.status(404).json({ error: 'Outbox item not found' });
  const { status, last_error = null }: CompleteOutboxInput = req.body;
  if (!['done', 'failed', 'skipped'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const updated = {
    ...row, status, attempts: row.attempts + 1,
    last_error: status === 'failed' ? (last_error ?? null) : null,
    pushed_at: status === 'done' ? now() : row.pushed_at,
  };
  await db.update(outbox).set(updated).where(eq(outbox.id, req.params.id)).run();

  const actor = actorOf(req);
  if (status === 'done') {
    await logActivity({ actor, type: 'pushed_to_external', task_id: row.origin_task_id ?? undefined,
      summary: `Pushed ${row.kind} to external system`, detail: { outbox_id: row.id, kind: row.kind, target: JSON.parse(row.target || '{}') } });
  } else if (status === 'failed') {
    await logActivity({ actor, type: 'pushed_to_external', task_id: row.origin_task_id ?? undefined,
      summary: `Failed to push ${row.kind}: ${last_error ?? 'unknown error'}`, detail: { outbox_id: row.id, kind: row.kind, last_error: last_error ?? null } });
  }
  return res.json(parseRow(updated));
});

// POST /api/outbox/:id/retry
router.post('/:id/retry', async (req: Request, res: Response) => {
  const row = await db.select().from(outbox).where(eq(outbox.id, req.params.id)).get();
  if (!row) return res.status(404).json({ error: 'Outbox item not found' });
  if (row.status !== 'failed') return res.status(400).json({ error: 'Only failed items can be retried' });
  const updated = { ...row, status: 'pending' as const, last_error: null };
  await db.update(outbox).set(updated).where(eq(outbox.id, req.params.id)).run();
  return res.json(parseRow(updated));
});

export default router;
```

- [ ] **Step 3: Mount in `backend/src/index.ts`** — add `import outboxRouter from './routes/outbox';` and `app.use('/api/outbox', outboxRouter);`.

- [ ] **Step 4: Enqueue outbox intents on approve in `backend/src/routes/proposals.ts`** — add imports at the top: `import { outbox } from '../db/schema';` and `import type { EnqueueOutboxInput } from '../../../shared/types';` (`uuidv4` and `now()` already exist in the file). Then, inside `doApprove(...)`, immediately after the kind-apply block and before the `db.update(proposals).set({ status: 'applied', ... })` call, insert:
```ts
  // Phase 3: enqueue any outbox intents the (edited) payload carries.
  // The backend stays dumb — it enqueues exactly what the proposal specifies;
  // Claude/the routine performs the external writes by draining the outbox.
  const outboxIntents: EnqueueOutboxInput[] = Array.isArray((payload as any).outbox) ? (payload as any).outbox : [];
  for (const intent of outboxIntents) {
    await db.insert(outbox).values({
      id: uuidv4(), created_at: now(), kind: intent.kind, status: 'pending',
      target: JSON.stringify(intent.target ?? {}), payload: JSON.stringify(intent.payload ?? {}),
      origin_proposal_id: row.id, origin_task_id: intent.origin_task_id ?? null,
      attempts: 0, last_error: null, pushed_at: null,
    }).run();
  }
```
(`row` is the proposal row and `payload` is the parsed payload — both already in scope in `doApprove`.)

- [ ] **Step 5: Run verification and commit**
Run: `npm --prefix backend test src/routes/outbox.test.ts` → Expected: all pass.
```bash
git add backend/src/routes/outbox.ts backend/src/index.ts backend/src/routes/proposals.ts backend/src/routes/outbox.test.ts
git commit -m "feat(api): outbox routes + enqueue outbox intents on proposal approve"
```

---

### Task 18: MCP outbox tools + routine drain step

**Goal:** Expose `list_outbox` and `complete_outbox_item` from the MCP server, and add a drain step to the daily routine that performs each pending external write (Atlassian one at a time) and reports the result. The app never makes these calls; the routine is the only actuator.

**Files:**
- Modify: `mcp-server/src/index.ts`
- Modify: `~/.claude/scheduled-tasks/daily-morning-briefing/SKILL.md` (outside the app repo — not committed here)

**Acceptance Criteria:**
- [ ] `list_outbox` calls `GET /api/outbox?status=<status>` (default `pending`); `complete_outbox_item` PATCHes `/api/outbox/:id`.
- [ ] Both reuse `api()` (which sends `X-TM-Actor: claude`).
- [ ] `npm --prefix mcp-server run build` succeeds.
- [ ] SKILL.md gains a "Drain the outbox" step after Step 3 stating: the app never performs external writes; Atlassian writes are one at a time per Step 0b; each item is reported via `complete_outbox_item`.

**Verify:** `npm --prefix mcp-server run build` → exit 0. Routine portion: manual dry-run, no app-repo commit.

**Steps:**

- [ ] **Step 1: Add the two tools in `mcp-server/src/index.ts`** (before `// --- Start ---`)
```ts
server.tool(
  "list_outbox",
  "List queued external-write intents (the outbox) that the routine must perform. Each item has a kind, a target, and a payload. Enqueued by approved proposals; the app never performs the writes itself.",
  { status: z.enum(["pending", "in_progress", "done", "failed", "skipped"]).default("pending").describe("Filter by status (default: pending)") },
  async ({ status }) => {
    try {
      const items = await api(`/outbox?status=${status}`);
      if (!Array.isArray(items) || items.length === 0) {
        return { content: [{ type: "text" as const, text: `No outbox items with status '${status}'.` }] };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(items, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  "complete_outbox_item",
  "Report the result of performing an outbox item's external write. Use 'done' on success, 'failed' with last_error on failure, or 'skipped' if intentionally not performed.",
  {
    id: z.string().describe("Outbox item id"),
    status: z.enum(["done", "failed", "skipped"]).describe("Result status"),
    last_error: z.string().optional().describe("Error message (required when status is 'failed')"),
  },
  async ({ id, status, last_error }) => {
    try {
      const item = await api(`/outbox/${id}`, { method: "PATCH", body: JSON.stringify({ status, last_error: last_error ?? null }) });
      return { content: [{ type: "text" as const, text: `Outbox ${id} → ${item.status}${item.pushed_at ? ` (pushed ${item.pushed_at})` : ""}${item.last_error ? ` — ${item.last_error}` : ""}` }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }
);
```

- [ ] **Step 2: Build** — `npm --prefix mcp-server run build`.

- [ ] **Step 3: Add the drain step to `daily-morning-briefing/SKILL.md`** — insert `## Step 3b: Drain the outbox (external write-back — this context only)` after Step 3 and before Step 4. It must state: (1) call `list_outbox` (pending), skip the step entirely if empty; (2) for each item, perform the write by `kind` — `jira_update_dates` → `editJiraIssue` on `target.idea_key` setting `payload.fields`; `confluence_refresh_page` → `updateConfluencePage` on `target.page_id`; `jira_transition` → `transitionJiraIssue`; unknown → `skipped`; (3) **Atlassian concurrency (Step 0b) applies without exception — every jira_*/confluence_* write is one Atlassian MCP call issued STRICTLY ONE AT A TIME**, never two in one message, wait for each before the next; (4) immediately after each write returns, call `complete_outbox_item` with `done` or `failed`+`last_error`; (5) add a short "📤 Pushed to external systems" briefing line for successes and, separately, failures (which stay queued for retry); omit if nothing drained.

- [ ] **Step 4: Verify + commit (MCP only)**
Routine dry-run checklist (manual, not committed): reads pending via `list_outbox`; only one Atlassian call in flight at a time; each item ends `done`/`failed`/`skipped`.
```bash
git add mcp-server/src/index.ts
git commit -m "feat(mcp): list_outbox + complete_outbox_item tools for outbox drain"
```

---

### Task 19: Frontend Outbox status panel + client/context + route and sidebar link

**Goal:** Add an Outbox view showing pending/failed counts and a per-item list with a Retry button for failed items, wired to the client/context, at `/outbox` with a Sidebar link.

**Files:**
- Create: `frontend/src/components/outbox/OutboxPanel.tsx`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/context/AppContext.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`

**Acceptance Criteria:**
- [ ] `api.getOutbox(status?)` and `api.retryOutbox(id)` call `GET /api/outbox[?status=]` and `POST /api/outbox/:id/retry`.
- [ ] Context exposes `state.outbox`, `loadOutbox()`, `retryOutbox(id)` (which refreshes the list).
- [ ] `OutboxPanel` shows pending/failed counts and lists items with status badge, kind, last error, attempts, and a Retry button on failed items only.
- [ ] `/outbox` route renders the panel; a Sidebar link navigates to it.
- [ ] `npm --prefix frontend run build` succeeds.

**Verify:** `npm --prefix frontend run build` → exit 0.

**Steps:**

- [ ] **Step 1: Add client methods to `frontend/src/api/client.ts`** (after the Phase 2 roadmap methods)
```ts
  // Outbox (Phase 3)
  getOutbox: (status?: string) =>
    request<import('@shared/types').OutboxItem[]>(`/outbox${status ? `?status=${status}` : ''}`),
  retryOutbox: (id: string) =>
    request<import('@shared/types').OutboxItem>(`/outbox/${id}/retry`, { method: 'POST' }),
```

- [ ] **Step 2: Wire the context in `frontend/src/context/AppContext.tsx`**
  - Add `OutboxItem` to the `@shared/types` import.
  - `AppState`: add `outbox: OutboxItem[];`
  - `Action`: add `| { type: 'SET_OUTBOX'; payload: OutboxItem[] }`
  - reducer: add `case 'SET_OUTBOX': return { ...state, outbox: action.payload };`
  - `initialState`: add `outbox: [],`
  - `AppContextValue`: add `loadOutbox: () => Promise<void>;` and `retryOutbox: (id: string) => Promise<void>;`
  - implementations:
```ts
  const loadOutbox = useCallback(async () => {
    try {
      const outbox = await api.getOutbox();
      dispatch({ type: 'SET_OUTBOX', payload: outbox });
    } catch (e) { dispatch({ type: 'SET_ERROR', payload: (e as Error).message }); }
  }, []);

  const retryOutbox = useCallback(async (id: string) => {
    try {
      await api.retryOutbox(id);
      const outbox = await api.getOutbox();
      dispatch({ type: 'SET_OUTBOX', payload: outbox });
    } catch (e) { dispatch({ type: 'SET_ERROR', payload: (e as Error).message }); }
  }, []);
```
  - add `loadOutbox, retryOutbox` to the provider `value`.

- [ ] **Step 3: Create `frontend/src/components/outbox/OutboxPanel.tsx`**
```tsx
import { useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import type { OutboxItem } from '@shared/types';

function statusClass(status: string) {
  switch (status) {
    case 'pending': return 'bg-amber-100 text-amber-700';
    case 'in_progress': return 'bg-blue-100 text-blue-700';
    case 'done': return 'bg-green-100 text-green-700';
    case 'failed': return 'bg-red-100 text-red-700';
    default: return 'bg-slate-100 text-slate-600';
  }
}

export function OutboxPanel() {
  const { state, loadOutbox, retryOutbox } = useApp();
  useEffect(() => { loadOutbox(); }, [loadOutbox]);

  const items = state.outbox;
  const pending = items.filter((i) => i.status === 'pending' || i.status === 'in_progress');
  const failed = items.filter((i) => i.status === 'failed');

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-slate-900 mb-1">Outbox</h1>
      <p className="text-sm text-slate-500 mb-6">
        External writes queued by approved proposals. The app never calls external systems —
        the daily routine drains these and reports the results here.
      </p>

      <div className="flex gap-4 mb-6">
        <div className="flex-1 bg-white border border-slate-200 rounded-lg px-4 py-3">
          <div className="text-2xl font-bold text-amber-600">{pending.length}</div>
          <div className="text-xs text-slate-500 uppercase tracking-wider">Pending</div>
        </div>
        <div className="flex-1 bg-white border border-slate-200 rounded-lg px-4 py-3">
          <div className="text-2xl font-bold text-red-600">{failed.length}</div>
          <div className="text-xs text-slate-500 uppercase tracking-wider">Failed</div>
        </div>
      </div>

      <div className="space-y-2">
        {items.length === 0 && <p className="text-sm text-slate-500">The outbox is empty.</p>}
        {items.map((item: OutboxItem) => (
          <div key={item.id} className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex items-center gap-3">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusClass(item.status)}`}>{item.status}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-800 truncate">{item.kind}</div>
              {item.last_error && <div className="text-xs text-red-600 truncate" title={item.last_error}>{item.last_error}</div>}
            </div>
            {item.attempts > 0 && <span className="text-xs text-slate-400 flex-shrink-0">{item.attempts} attempt{item.attempts === 1 ? '' : 's'}</span>}
            {item.status === 'failed' && (
              <button onClick={() => retryOutbox(item.id)} className="text-xs font-medium px-3 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors flex-shrink-0">Retry</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add the route to `frontend/src/App.tsx`** — `import { OutboxPanel } from './components/outbox/OutboxPanel';` and `<Route path="/outbox" element={<OutboxPanel />} />` inside `<Layout>`.

- [ ] **Step 5: Add the Sidebar link** — inside the Task-8 nav group, after the Roadmap link:
```tsx
          <Link
            to="/outbox"
            className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              location.pathname === '/outbox' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8l6 6 6-6M5 16h14" />
            </svg>
            Outbox
          </Link>
```

- [ ] **Step 6: Run verification and commit**
```bash
git add frontend/src/components/outbox/OutboxPanel.tsx frontend/src/api/client.ts frontend/src/context/AppContext.tsx frontend/src/App.tsx frontend/src/components/layout/Sidebar.tsx
git commit -m "feat(ui): outbox status panel with retry + route and sidebar link"
```

---

## Self-Review (completed)

- **Spec coverage:** Inbox/proposals (Tasks 2,4,7,9,10), activity log (Tasks 2,3), live cockpit + upcoming (Tasks 5,6,8), MCP propose tools + routine rewrite (Tasks 10,11), roadmap-as-data + reconciliation + import (Tasks 12–15), outbox write-back + drain (Tasks 16–19). Every spec section maps to at least one task.
- **Placeholder scan:** no TBD/TODO; every step carries complete code or an exact edit description.
- **Type consistency:** shared types defined once (Task 2 / 12 / 16), consumed consistently; `logActivity({type})`, `actorOf`, `ProposalPayload`, `RoadmapItem`, `OutboxItem`, and the `db` schema registration are cumulative and named identically across tasks (see Reconciliation Notes).


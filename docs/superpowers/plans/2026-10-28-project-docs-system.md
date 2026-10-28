# Project Docs System (TaskManager) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers-extended-cc:subagent-driven-development (if subagents available) or superpowers-extended-cc:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TaskManager knows which docs every roadmap project and proposal owes, when each is due and its status. It shows this in a Docs grid, a per-project Docs panel, a grouped sidebar and a dashboard card, and exposes MCP tools so the daily check can sync the roadmap and apply results.

**Architecture:**
- **The doc matrix is one pure TypeScript module** (`shared/doc-matrix.ts`), shared by the backend and the frontend. It holds the rows, due rules and status rules.
- **The backend stores:**
  - a copy of each roadmap item (`roadmap_items`), synced by Claude through MCP, since the backend holds no external credentials;
  - doc-system fields on `projects`;
  - doc fields on `tasks`.
- **Two backend operations:**
  - `docs/health` computes statuses on the fly.
  - `docs/apply` upserts one task per required doc, re-dates tasks when roadmap dates move, and logs each change to `activity`.

**Tech Stack:** Node + Express + Drizzle ORM 0.30 + libsql (SQLite); React 19 + React Router 7 + Tailwind 3 (Vite); `@modelcontextprotocol/sdk` + zod. Tests: Vitest + supertest.

**Spec:** `docs/superpowers/specs/2026-10-28-project-docs-system-design.md`

**Scope.** This plan covers spec build-order steps 1–2 (matrix, data model, API, MCP and UI), plus a live dry run. Separate plans will cover:
- the Confluence tree and hub scaffolding (step 3);
- the doc check in the daily briefing (step 4);
- the proposals' Confluence flow (step 5);
- roadmap write-back (step 6);
- updating `~/Claude Assistant/knowledge/project-lifecycle-template.md`.

---

## File map

**Shared**
- Create `shared/doc-matrix.ts`: matrix rows, due rules, status rules, date helpers. Pure, no imports.
- Modify `shared/types.ts`: doc-system types; new optional fields on `Project` and `Task`.

**Backend**
- Modify `backend/package.json`, `backend/src/index.ts`; create `backend/vitest.config.ts`, `backend/src/test/setup.ts`, `backend/.gitignore`: test harness.
- Modify `backend/src/db/schema.ts`, `backend/src/db/migrate.ts`, `backend/src/db/index.ts`: new tables and columns, plus a backfill.
- Create `backend/src/lib/activity.ts`: `logActivity`, `actorOf`.
- Create `backend/src/lib/doc-check.ts`: builds the doc context, evidence and project health from DB rows.
- Create `backend/src/routes/roadmap.ts`: `POST /api/roadmap/sync`, `GET /api/roadmap`.
- Create `backend/src/routes/docs.ts`: `GET /api/docs/health`, `POST /api/docs/apply`.
- Modify `backend/src/routes/projects.ts`: serialize the new fields; `PATCH /api/projects/:id/docs`; roadmap fields on the list.
- Tests in `backend/src/test/`: `doc-matrix.test.ts`, `roadmap.test.ts`, `projects-docs.test.ts`, `docs.test.ts`, `helpers.ts`.

**MCP**
- Modify `mcp-server/src/index.ts`: `sync_roadmap`, `get_doc_health`, `apply_doc_check`, `set_project_decision`, `link_project`; an `X-Actor: claude` header.

**Frontend**
- Modify `frontend/tsconfig.app.json`: the `@shared` path, so `tsc -b` resolves it. The typecheck is broken on main today.
- Modify `frontend/src/components/dashboard/Dashboard.tsx`, `tasks/TaskList.tsx`, `tasks/TaskForm.tsx`: remove the 3 existing unused-code errors.
- Modify `frontend/src/api/client.ts`, `frontend/src/utils/index.ts`.
- Create `frontend/src/components/docs/DocStatusChip.tsx`, `DocsPanel.tsx`, `DocsPage.tsx`.
- Modify `frontend/src/components/projects/ProjectDetail.tsx`, `layout/Sidebar.tsx`, `dashboard/Dashboard.tsx`, `frontend/src/App.tsx`.

---

### Task 0: Clear the working tree

**Goal:** Nothing uncommitted overlaps the files this plan edits.

**Files:** none created. Affects `frontend/src/api/client.ts`, `layout/Sidebar.tsx`, `projects/ProjectDetail.tsx`, `tasks/TaskBoard.tsx`, `context/AppContext.tsx`, `backend/package-lock.json`.

**Acceptance Criteria:**
- [ ] `git status --short` shows no modified tracked files under `frontend/src` or `backend/`.

**Verify:** `git status --short frontend/src backend/package.json backend/package-lock.json` → no output.

**Steps:**

- [ ] **Step 1: Ask Brice how to handle the pending work.** It's the "Archived projects" sidebar feature (`loadArchivedProjects`, `restoreProject`) plus related edits. Ask whether to **commit it as is** or **stash it**. Don't decide without asking.
- [ ] **Step 2: Do what Brice chose.**
  - To commit: `git add frontend/src backend/package-lock.json && git commit -m "feat(ui): archived projects section with restore"`.
  - To stash: `git stash push -m "pre-docs-system WIP" -- frontend/src backend/package-lock.json`.
- [ ] **Step 3: Run the verify command.** Expected: no output.

---

### Task 1: Backend test harness (Vitest + supertest)

**Goal:** `npm --prefix backend test` runs Vitest against a throwaway SQLite DB. This is the same harness as control-plane Task 1. **If `backend/vitest.config.ts` already exists, skip this task.**

**Files:**
- Modify: `backend/package.json`, `backend/src/index.ts`
- Create: `backend/vitest.config.ts`, `backend/src/test/setup.ts`, `backend/.gitignore`, `backend/src/test/sanity.test.ts`

**Acceptance Criteria:**
- [ ] `npm --prefix backend test` passes the 2 sanity tests.
- [ ] Importing the app in tests doesn't bind a port.
- [ ] `test-taskmanager.db*` is git-ignored.

**Verify:** `npm --prefix backend test` → `2 passed`.

**Steps:**

- [ ] **Step 1: Add scripts and dev dependencies to `backend/package.json`.**
  - Under `"scripts"` add `"test": "vitest run"` and `"test:watch": "vitest"`.
  - Under `"devDependencies"` add `"vitest": "^1.6.0"`, `"supertest": "^6.3.4"`, `"@types/supertest": "^6.0.2"`.

- [ ] **Step 2: In `backend/src/index.ts`, replace the final `app.listen(...)` block** (keep `export default app;` last):
```ts
if (process.env.NODE_ENV !== 'test' && process.env.VITEST === undefined) {
  app.listen(PORT, () => {
    console.log(`TaskManager API running on http://localhost:${PORT}`);
  });
}
```

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

- [ ] **Step 7: Install, run the tests and commit.**
Run: `npm --prefix backend install && npm --prefix backend test` → `2 passed`.
```bash
git add backend/package.json backend/package-lock.json backend/vitest.config.ts backend/src/test/setup.ts backend/src/index.ts backend/.gitignore backend/src/test/sanity.test.ts
git commit -m "test(backend): add vitest+supertest harness with listen guard"
```

---

### Task 2: Fix the frontend typecheck baseline

**Goal:** `npx tsc -b` in `frontend/` passes. Today it fails because `@shared/*` isn't in the tsconfig paths (Vite has the alias, tsc doesn't), and 3 unused-code errors remain.

**Files:**
- Modify: `frontend/tsconfig.app.json`
- Modify: `frontend/src/components/dashboard/Dashboard.tsx:4`
- Modify: `frontend/src/components/tasks/TaskList.tsx:4`
- Modify: `frontend/src/components/tasks/TaskForm.tsx:97-117`

**Acceptance Criteria:**
- [ ] `cd frontend && npx tsc -b` exits 0.
- [ ] `npx vite build` still succeeds.

**Verify:** `cd frontend && npx tsc -b && npx vite build` → exit 0.

**Steps:**

- [ ] **Step 1: Add the path mapping in `frontend/tsconfig.app.json`.**
  - Inside `"compilerOptions"`, after `"noUncheckedSideEffectImports": true`, add:
```json
    "baseUrl": ".",
    "paths": { "@shared/*": ["../shared/*"] }
```
  - Change `"include": ["src"]` to `"include": ["src", "../shared"]`.

- [ ] **Step 2: Remove the dead code.**
  - `Dashboard.tsx`: delete line 4, `import { isOverdue, formatDate } from '../../utils';`. tsc reports both as unused.
  - `TaskList.tsx` line 4: change the import to `import { PRIORITY_COLORS, PRIORITY_LABELS, formatDate, isOverdue } from '../../utils';`.
  - `TaskForm.tsx`: delete the whole unused `const handleSubmit = async (e: React.FormEvent) => { ... };` function. It starts at line 97 and ends just before the `// For new tasks: create first, then attach images via update` comment. The form uses `handleSubmitWithImages`.

- [ ] **Step 3: Run the verify command and commit.**
```bash
git add frontend/tsconfig.app.json frontend/src/components/dashboard/Dashboard.tsx frontend/src/components/tasks/TaskList.tsx frontend/src/components/tasks/TaskForm.tsx
git commit -m "fix(frontend): resolve @shared in tsc and remove dead code so tsc -b passes"
```

---

### Task 3: Doc matrix module

**Goal:** `shared/doc-matrix.ts` implements the spec's matrix and status rules as pure functions, fully unit-tested.

**Files:**
- Create: `shared/doc-matrix.ts`
- Test: `backend/src/test/doc-matrix.test.ts`

**Acceptance Criteria:**
- [ ] The rows match the spec table: keys, anchors, offsets and fallbacks.
- [ ] Status precedence:
  - `done` → `waived` (stopped or waiver) → proposal (`draft`/`missing`, never dated) → `cant_date` → `inactive` → `overdue` → `draft` (unpublished page) → `due_soon` (≤14 days) → `draft` (exists) → `missing`.
- [ ] Link-only rows (`hub`, `figma`, `jira_epic`) are done when the link is set. Other rows need published-or-linked AND the task done. `experiment_brief.results` also needs `results_filled`.
- [ ] A row is active when its phase ≤ the stage's phase, or once `today ≥ due − 28d`.
- [ ] Stopped (`on-hold`, `wont-do` or decision `no_go`): every row that isn't done is `waived`.

**Verify:** `npm --prefix backend test -- doc-matrix` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing tests in `backend/src/test/doc-matrix.test.ts`**
```ts
import { describe, it, expect } from 'vitest';
import {
  evaluateDocs, describeRule, addDays, daysBetween,
  type DocContext, type DocEvidence, type DocKey,
} from '../../../shared/doc-matrix';

const TODAY = '2026-10-28';

// WW - Modular Elements as of 2026-10-28
const modular: DocContext = {
  stage: 'build',
  phases: {
    discovery: { start: '2026-03-01', end: '2026-03-30' },
    build: { start: '2026-08-04', end: '2026-11-10' },
    measure: { start: '2026-11-10', end: '2026-12-01' },
  },
  entered_scope_at: '2026-09-01',
  doc_mode: 'full',
  customer_facing: false,
  waivers: {},
  decision: null,
};

const byKey = (rows: ReturnType<typeof evaluateDocs>) =>
  Object.fromEntries(rows.map((r) => [r.key, r]));

describe('evaluateDocs', () => {
  it('lists only required rows, in matrix order', () => {
    const rows = evaluateDocs(modular, {}, TODAY);
    expect(rows.map((r) => r.key)).toEqual([
      'hub', 'one_pager', 'prd', 'experiment_brief.plan', 'jira_epic',
      'release_notes', 'metrics_snapshot', 'experiment_brief.results',
    ]);
  });

  it('computes due dates and readable rules', () => {
    const r = byKey(evaluateDocs(modular, {}, TODAY));
    expect(r.prd.due).toBe('2026-07-21');
    expect(r.prd.due_rule).toBe('Build start −2w');
    expect(r.one_pager.due).toBe('2026-03-15');
    expect(r.release_notes.due).toBe('2026-11-10');
    expect(r.metrics_snapshot.due).toBe('2026-11-24');
    expect(r['experiment_brief.results'].due).toBe('2026-12-01');
  });

  it('assigns statuses with no evidence', () => {
    const r = byKey(evaluateDocs(modular, {}, TODAY));
    expect(r.hub.status).toBe('overdue');
    expect(r.prd.status).toBe('overdue');
    expect(r.release_notes.status).toBe('due_soon');
    expect(r.metrics_snapshot.status).toBe('missing');
    expect(r['experiment_brief.results'].status).toBe('inactive');
  });

  it('uses the fallback rule when the anchor date is missing', () => {
    const ctx: DocContext = {
      ...modular,
      phases: { build: { start: '2026-08-04', end: '2026-11-10' } },
      entered_scope_at: '2026-10-01',
    };
    const r = byKey(evaluateDocs(ctx, {}, TODAY));
    expect(r.one_pager.due).toBe('2026-10-15');
    expect(r.one_pager.due_rule).toBe('Entered roadmap +2w');
  });

  it("marks rows can't-date when anchor and fallback are both missing", () => {
    const ctx: DocContext = { ...modular, stage: 'roadmap', phases: {}, entered_scope_at: null };
    const rows = evaluateDocs(ctx, {}, TODAY);
    expect(rows.map((x) => x.key)).toEqual(['hub', 'one_pager', 'prd', 'jira_epic', 'release_notes']);
    expect(rows.every((x) => x.status === 'cant_date')).toBe(true);
  });

  it('needs the task done for page docs', () => {
    const page: DocEvidence = { page_url: 'https://minted.atlassian.net/wiki/spaces/PM/pages/1/x', published: true };
    expect(byKey(evaluateDocs(modular, { prd: { ...page, task_done: false } }, TODAY)).prd.status).toBe('overdue');
    expect(byKey(evaluateDocs(modular, { prd: { ...page, task_done: true } }, TODAY)).prd.status).toBe('done');
  });

  it('shows an unpublished page as draft when not yet overdue', () => {
    const ev = { release_notes: { page_url: 'https://x/pages/5', published: false } };
    expect(byKey(evaluateDocs(modular, ev, TODAY)).release_notes.status).toBe('draft');
  });

  it('needs the results section for experiment_brief.results', () => {
    const ctx = { ...modular, stage: 'measure' as const };
    const base = { page_url: 'https://x/pages/9', published: true, task_done: true };
    const late = '2026-12-10';
    expect(byKey(evaluateDocs(ctx, { 'experiment_brief.results': base }, late))['experiment_brief.results'].status).toBe('overdue');
    expect(byKey(evaluateDocs(ctx, { 'experiment_brief.results': { ...base, results_filled: true } }, late))['experiment_brief.results'].status).toBe('done');
  });

  it('treats link-only rows as done once the link is set', () => {
    const r = byKey(evaluateDocs(modular, { jira_epic: { link: 'https://minted.atlassian.net/browse/WW-1' } }, TODAY));
    expect(r.jira_epic.status).toBe('done');
  });

  it('applies waivers', () => {
    const ctx: DocContext = { ...modular, waivers: { one_pager: 'predates system' } };
    expect(byKey(evaluateDocs(ctx, {}, TODAY)).one_pager.status).toBe('waived');
  });

  it('waives everything not done once the item is stopped', () => {
    const ctx: DocContext = { ...modular, stage: 'wont-do' };
    const done: DocEvidence = { page_url: 'https://x/pages/2', published: true, task_done: true };
    const r = byKey(evaluateDocs(ctx, { prd: done }, TODAY));
    expect(r.prd.status).toBe('done');
    expect(r.jira_epic.status).toBe('waived');
    expect(r.release_notes.status).toBe('waived');
  });

  it('drops the PRD in one-pager-only mode', () => {
    const rows = evaluateDocs({ ...modular, doc_mode: 'one_pager_only' }, {}, TODAY);
    expect(rows.some((x) => x.key === 'prd')).toBe(false);
  });

  it('only asks a proposal for its one-pager, undated', () => {
    const ctx: DocContext = { ...modular, stage: null, phases: {}, entered_scope_at: null };
    const rows = evaluateDocs(ctx, {}, TODAY);
    expect(rows.map((x) => x.key)).toEqual(['one_pager']);
    expect(rows[0].due).toBeNull();
    expect(rows[0].due_rule).toBe('Before roadmap');
    expect(rows[0].status).toBe('missing');
    expect(evaluateDocs(ctx, { one_pager: { page_url: 'https://x/pages/3', published: false } }, TODAY)[0].status).toBe('draft');
    expect(evaluateDocs(ctx, { one_pager: { page_url: 'https://x/pages/3', published: true } }, TODAY)[0].status).toBe('done');
  });

  it('flags a mismatch between the roadmap link and the hub child page', () => {
    const ev = (link: string): Partial<Record<DocKey, DocEvidence>> => ({
      prd: { link, page_url: 'https://minted.atlassian.net/wiki/spaces/PM/pages/222/PRD' },
    });
    expect(byKey(evaluateDocs(modular, ev('https://minted.atlassian.net/wiki/spaces/PM/pages/111/Old'), TODAY)).prd.mismatch).toBe(true);
    expect(byKey(evaluateDocs(modular, ev('https://minted.atlassian.net/wiki/spaces/PM/pages/222/Other+title'), TODAY)).prd.mismatch).toBe(false);
  });
});

describe('helpers', () => {
  it('describes rules', () => {
    expect(describeRule({ anchor: 'build.start', offsetDays: -14 })).toBe('Build start −2w');
    expect(describeRule({ anchor: 'measure.end', offsetDays: 0 })).toBe('Measure end');
    expect(describeRule({ anchor: 'build.end', offsetDays: -7 })).toBe('Build end −1w');
    expect(describeRule({ anchor: 'discovery.start', offsetDays: 3 })).toBe('Discovery start +3d');
  });

  it('does date math in UTC', () => {
    expect(addDays('2026-10-25', 14)).toBe('2026-11-08');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-01', '2026-10-28')).toBe(27);
    expect(daysBetween('2026-10-01T15:00:00.000Z', '2026-10-28')).toBe(27);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**
Run: `npm --prefix backend test -- doc-matrix` → fails with "Cannot find module '../../../shared/doc-matrix'".

- [ ] **Step 3: Create `shared/doc-matrix.ts`**
```ts
// Doc matrix: which docs a project owes, when each is due, and its status.
// Pure module shared by backend and frontend. Spec:
// docs/superpowers/specs/2026-10-28-project-docs-system-design.md

export type RoadmapStage =
  | 'not-started' | 'roadmap' | 'discover' | 'plan' | 'ready-for-build'
  | 'build' | 'measure' | 'done' | 'on-hold' | 'wont-do';

export type PhaseKey = 'discovery' | 'ux' | 'uxr' | 'build' | 'measure';
export type DocPhase = 'discovery' | 'ux' | 'build' | 'measure';

export interface PhaseDates {
  start?: string | null;
  end?: string | null;
}
export type Phases = Partial<Record<PhaseKey, PhaseDates>>;

export type DocKey =
  | 'hub' | 'one_pager' | 'research' | 'prd' | 'figma' | 'experiment_brief.plan'
  | 'jira_epic' | 'cs_marketing_brief' | 'release_notes' | 'metrics_snapshot'
  | 'experiment_brief.results';

export type DocStatus =
  | 'done' | 'draft' | 'due_soon' | 'overdue' | 'missing' | 'waived' | 'cant_date' | 'inactive';

export const DOC_STATUSES: DocStatus[] = [
  'overdue', 'due_soon', 'missing', 'cant_date', 'draft', 'done', 'waived', 'inactive',
];

export type Anchor =
  | 'entered_scope' | 'discovery.start' | 'discovery.end'
  | 'build.start' | 'build.end' | 'measure.start' | 'measure.end';

export interface DueRule {
  anchor: Anchor;
  offsetDays: number;
}

/** Roadmap link field that counts as evidence for a row. */
export type RoadmapLinkField =
  | 'prd' | 'figma' | 'jiraEpic' | 'releaseNotes' | 'hub' | 'onePager' | 'experimentBrief';

export interface DocContext {
  /** Roadmap stage; null = proposal (not on the roadmap yet). */
  stage: RoadmapStage | null;
  phases: Phases;
  /** When the item first entered scope (first roadmap sync). */
  entered_scope_at: string | null;
  doc_mode: 'full' | 'one_pager_only';
  customer_facing: boolean;
  waivers: Partial<Record<DocKey, string>>;
  decision: 'go' | 'no_go' | 'parked' | null;
}

export interface DocEvidence {
  /** Value of the roadmap link field (or project hub/one-pager URL). */
  link?: string | null;
  /** Child page of the hub found by the doc check. */
  page_url?: string | null;
  published?: boolean;
  results_filled?: boolean;
  task_done?: boolean;
}

export interface DocRow {
  key: DocKey;
  phase: DocPhase | null;
  label: string;
  /** Confluence child page title suffix: "[OI] <name> — <pageTitle>". */
  pageTitle: string;
  required: (c: DocContext) => boolean;
  due: DueRule;
  fallback?: DueRule;
  roadmapLink?: RoadmapLinkField;
  /** Done as soon as the link is set; no task completion needed. */
  linkOnly?: boolean;
  /** Done only when the page's Results section has content. */
  needsResults?: boolean;
}

export interface DocRowResult {
  key: DocKey;
  label: string;
  phase: DocPhase | null;
  due: string | null;
  due_rule: string;
  status: DocStatus;
  mismatch: boolean;
  link: string | null;
}

const onRoadmap = (c: DocContext) => c.stage !== null;
const hasPhase = (c: DocContext, p: PhaseKey) => Boolean(c.phases[p]?.start || c.phases[p]?.end);

export const DOC_MATRIX: DocRow[] = [
  { key: 'hub', phase: null, label: 'Hub', pageTitle: 'Hub', required: onRoadmap,
    due: { anchor: 'entered_scope', offsetDays: 0 }, roadmapLink: 'hub', linkOnly: true },
  { key: 'one_pager', phase: 'discovery', label: 'One-Pager', pageTitle: 'One-Pager', required: () => true,
    due: { anchor: 'discovery.start', offsetDays: 14 }, fallback: { anchor: 'entered_scope', offsetDays: 14 },
    roadmapLink: 'onePager' },
  { key: 'research', phase: 'discovery', label: 'Research Synthesis', pageTitle: 'Research Synthesis',
    required: (c) => hasPhase(c, 'uxr'),
    due: { anchor: 'discovery.end', offsetDays: 0 }, fallback: { anchor: 'build.start', offsetDays: -56 } },
  { key: 'prd', phase: 'ux', label: 'Brief/PRD', pageTitle: 'Brief/PRD',
    required: (c) => onRoadmap(c) && c.doc_mode === 'full',
    due: { anchor: 'build.start', offsetDays: -14 }, roadmapLink: 'prd' },
  { key: 'figma', phase: 'ux', label: 'Figma', pageTitle: 'Figma', required: (c) => hasPhase(c, 'ux'),
    due: { anchor: 'build.start', offsetDays: 0 }, roadmapLink: 'figma', linkOnly: true },
  { key: 'experiment_brief.plan', phase: 'ux', label: 'Experiment Brief — Plan', pageTitle: 'Experiment Brief',
    required: (c) => hasPhase(c, 'measure'),
    due: { anchor: 'build.start', offsetDays: 0 }, roadmapLink: 'experimentBrief' },
  { key: 'jira_epic', phase: 'build', label: 'Jira Epic', pageTitle: 'Jira Epic', required: onRoadmap,
    due: { anchor: 'build.start', offsetDays: 0 }, roadmapLink: 'jiraEpic', linkOnly: true },
  { key: 'cs_marketing_brief', phase: 'build', label: 'CS/Marketing Brief', pageTitle: 'CS/Marketing Brief',
    required: (c) => onRoadmap(c) && c.customer_facing,
    due: { anchor: 'build.end', offsetDays: -7 } },
  { key: 'release_notes', phase: 'build', label: 'Release Notes', pageTitle: 'Release Notes', required: onRoadmap,
    due: { anchor: 'build.end', offsetDays: 0 }, roadmapLink: 'releaseNotes' },
  { key: 'metrics_snapshot', phase: 'measure', label: 'Metrics Snapshot', pageTitle: 'Metrics Snapshot',
    required: (c) => hasPhase(c, 'measure'),
    due: { anchor: 'measure.start', offsetDays: 14 }, fallback: { anchor: 'build.end', offsetDays: 14 } },
  { key: 'experiment_brief.results', phase: 'measure', label: 'Experiment Brief — Results', pageTitle: 'Experiment Brief',
    required: (c) => hasPhase(c, 'measure'),
    due: { anchor: 'measure.end', offsetDays: 0 }, fallback: { anchor: 'build.end', offsetDays: 42 },
    roadmapLink: 'experimentBrief', needsResults: true },
];

export const DOC_KEYS: DocKey[] = DOC_MATRIX.map((r) => r.key);

// ── dates (ISO YYYY-MM-DD, UTC) ────────────────────────────────────

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

// ── rules ──────────────────────────────────────────────────────────

const ANCHOR_LABEL: Record<Anchor, string> = {
  entered_scope: 'Entered roadmap',
  'discovery.start': 'Discovery start',
  'discovery.end': 'Discovery end',
  'build.start': 'Build start',
  'build.end': 'Build end',
  'measure.start': 'Measure start',
  'measure.end': 'Measure end',
};

export function describeRule(rule: DueRule): string {
  if (rule.offsetDays === 0) return ANCHOR_LABEL[rule.anchor];
  const sign = rule.offsetDays > 0 ? '+' : '−';
  const abs = Math.abs(rule.offsetDays);
  const amount = abs % 7 === 0 ? `${abs / 7}w` : `${abs}d`;
  return `${ANCHOR_LABEL[rule.anchor]} ${sign}${amount}`;
}

function anchorDate(c: DocContext, anchor: Anchor): string | null {
  if (anchor === 'entered_scope') return c.entered_scope_at ? c.entered_scope_at.slice(0, 10) : null;
  const [phase, edge] = anchor.split('.') as [PhaseKey, 'start' | 'end'];
  return c.phases[phase]?.[edge] ?? null;
}

export function computeDue(row: DocRow, c: DocContext): { due: string | null; rule: DueRule } {
  const primary = anchorDate(c, row.due.anchor);
  if (primary) return { due: addDays(primary, row.due.offsetDays), rule: row.due };
  if (row.fallback) {
    const fb = anchorDate(c, row.fallback.anchor);
    if (fb) return { due: addDays(fb, row.fallback.offsetDays), rule: row.fallback };
  }
  return { due: null, rule: row.due };
}

const STAGE_PHASE_INDEX: Record<RoadmapStage, number> = {
  'not-started': 0, roadmap: 0, discover: 0, plan: 1, 'ready-for-build': 1,
  build: 2, measure: 3, done: 3, 'on-hold': 0, 'wont-do': 0,
};
const PHASE_INDEX: Record<DocPhase, number> = { discovery: 0, ux: 1, build: 2, measure: 3 };

export function isStopped(c: DocContext): boolean {
  return c.decision === 'no_go' || c.stage === 'on-hold' || c.stage === 'wont-do';
}

export function isActive(row: DocRow, c: DocContext, due: string | null, today: string): boolean {
  if (row.phase === null) return true;
  if (c.stage === null) return row.key === 'one_pager';
  if (STAGE_PHASE_INDEX[c.stage] >= PHASE_INDEX[row.phase]) return true;
  return due !== null && today >= addDays(due, -28);
}

function pageKey(url: string): string {
  return url.match(/\/pages\/(\d+)/)?.[1] ?? url.match(/draftId=(\d+)/)?.[1] ?? url.replace(/\/$/, '');
}

function isMismatch(ev: DocEvidence): boolean {
  if (!ev.link || !ev.page_url) return false;
  return pageKey(ev.link) !== pageKey(ev.page_url);
}

function rowStatus(row: DocRow, c: DocContext, ev: DocEvidence, due: string | null, today: string): DocStatus {
  const proposal = c.stage === null;
  const exists = Boolean(ev.link || ev.page_url);
  const published = Boolean(ev.link || ev.published);
  const complete = row.linkOnly
    ? Boolean(ev.link)
    : published && (proposal || Boolean(ev.task_done)) && (!row.needsResults || Boolean(ev.results_filled));

  if (complete) return 'done';
  if (isStopped(c) || c.waivers[row.key]) return 'waived';
  if (proposal) return exists ? 'draft' : 'missing';
  if (due === null) return 'cant_date';
  if (!isActive(row, c, due, today)) return 'inactive';
  if (today > due) return 'overdue';
  if (ev.page_url && !ev.published) return 'draft';
  if (today >= addDays(due, -14)) return 'due_soon';
  return exists ? 'draft' : 'missing';
}

export function evaluateDocs(
  c: DocContext,
  evidence: Partial<Record<DocKey, DocEvidence>>,
  today: string,
): DocRowResult[] {
  const results: DocRowResult[] = [];
  for (const row of DOC_MATRIX) {
    if (!row.required(c)) continue;
    const ev = evidence[row.key] ?? {};
    const proposal = c.stage === null;
    const { due, rule } = proposal ? { due: null, rule: row.due } : computeDue(row, c);
    results.push({
      key: row.key,
      label: row.label,
      phase: row.phase,
      due,
      due_rule: proposal ? 'Before roadmap' : describeRule(rule),
      status: rowStatus(row, c, ev, due, today),
      mismatch: isMismatch(ev),
      link: ev.link ?? ev.page_url ?? null,
    });
  }
  return results;
}

export function docRow(key: DocKey): DocRow {
  const row = DOC_MATRIX.find((r) => r.key === key);
  if (!row) throw new Error(`Unknown doc key: ${key}`);
  return row;
}
```

- [ ] **Step 4: Run the tests and confirm they pass.**
Run: `npm --prefix backend test -- doc-matrix` → all tests pass.

- [ ] **Step 5: Commit**
```bash
git add shared/doc-matrix.ts backend/src/test/doc-matrix.test.ts
git commit -m "feat(shared): doc matrix with due rules and status evaluation"
```

---

### Task 4: Data model, migration and shared types

**Goal:** The DB has `roadmap_items`, `activity`, the doc-system columns on `projects` and the doc columns on `tasks`. Existing lifecycle tasks are backfilled with a `doc_key`. The shared types expose the new fields.

**Files:**
- Modify: `backend/src/db/schema.ts`, `backend/src/db/migrate.ts`, `backend/src/db/index.ts`, `shared/types.ts`
- Create: `backend/src/lib/activity.ts`
- Test: `backend/src/test/migrate.test.ts`

**Acceptance Criteria:**
- [ ] Running the migrations twice is harmless.
- [ ] A unique index on `tasks(project_id, doc_key)` applies where `doc_key IS NOT NULL`.
- [ ] Backfill:
  - "Write PRD" → `prd`; "Create experimentation doc" → `experiment_brief.plan`; "Write release notes" → `release_notes`; "2-week metrics check" → `metrics_snapshot`; "Final results readout" → `experiment_brief.results`.
  - At most one task per project gets each key.

**Verify:** `npm --prefix backend test -- migrate` → pass; `npx tsc --noEmit -p backend` → exit 0.

**Steps:**

- [ ] **Step 1: Write the failing test in `backend/src/test/migrate.test.ts`**
```ts
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
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run: `npm --prefix backend test -- migrate` → fails because the columns are missing.

- [ ] **Step 3: Extend `backend/src/db/schema.ts`.**
  - In `projects`, add these fields before `created_at`:
```ts
  roadmap_item_id: text('roadmap_item_id'),
  team: text('team'),
  docs_stage: text('docs_stage', { enum: ['proposal', 'roadmap', 'not_pursued'] }),
  decision: text('decision', { enum: ['go', 'no_go', 'parked'] }),
  decision_date: text('decision_date'),
  decision_reason: text('decision_reason'),
  revisit_by: text('revisit_by'),
  doc_mode: text('doc_mode', { enum: ['full', 'one_pager_only'] }).notNull().default('full'),
  customer_facing: integer('customer_facing').notNull().default(0),
  waivers: text('waivers').notNull().default('{}'),
  hub_url: text('hub_url'),
  one_pager_url: text('one_pager_url'),
```
  - In `tasks`, add these after `doc_type`:
```ts
  doc_key: text('doc_key'),
  doc_status: text('doc_status'),
  due_rule: text('due_rule'),
  doc_evidence: text('doc_evidence'),
```
  - Append these tables and types:
```ts
export const roadmapItems = sqliteTable('roadmap_items', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  team_id: text('team_id'),
  team_name: text('team_name'),
  parent_team_id: text('parent_team_id'),
  stage: text('stage').notNull(),
  status: text('status'),
  pm_name: text('pm_name'),
  jira_key: text('jira_key'),
  phases: text('phases').notNull().default('{}'),
  dev_start_half: text('dev_start_half'),
  links: text('links').notNull().default('{}'),
  hidden: integer('hidden').notNull().default(0),
  updated_at: text('updated_at'),
  first_seen_at: text('first_seen_at').notNull(),
  synced_at: text('synced_at').notNull(),
});

// Same shape as the control-plane design's activity log.
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

export type RoadmapItemRow = typeof roadmapItems.$inferSelect;
```

- [ ] **Step 4: Register the new tables in `backend/src/db/index.ts`.** Change the import and the `drizzle` call:
```ts
import { projects, tasks, roadmapItems, activity } from './schema';
// ...
export const db = drizzle(client, { schema: { projects, tasks, roadmapItems, activity } });
```

- [ ] **Step 5: Extend `backend/src/db/migrate.ts`.** Insert this block after the `doc_type` column check and before the "Ensure General project" block:
```ts
  for (const name of ['doc_key', 'doc_status', 'due_rule', 'doc_evidence']) {
    if (!colNames.has(name)) {
      await client.execute(`ALTER TABLE tasks ADD COLUMN ${name} TEXT`);
    }
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
  const TITLE_TO_DOC_KEY: [string, string][] = [
    ['Write PRD', 'prd'],
    ['Create experimentation doc', 'experiment_brief.plan'],
    ['Write release notes', 'release_notes'],
    ['2-week metrics check', 'metrics_snapshot'],
    ['Final results readout', 'experiment_brief.results'],
  ];
  for (const [title, key] of TITLE_TO_DOC_KEY) {
    await client.execute({
      sql: `UPDATE tasks SET doc_key = ?
            WHERE id IN (
              SELECT t.id FROM tasks t
              WHERE t.doc_key IS NULL AND t.title = ?
                AND NOT EXISTS (SELECT 1 FROM tasks t2 WHERE t2.project_id = t.project_id AND t2.doc_key = ?)
              GROUP BY t.project_id
            )`,
      args: [key, title, key],
    });
  }

  await client.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_project_doc_key ON tasks(project_id, doc_key) WHERE doc_key IS NOT NULL`
  );
```

- [ ] **Step 6: Create `backend/src/lib/activity.ts`**
```ts
import type { Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import { activity } from '../db/schema';

export type Actor = 'claude' | 'user';

/** MCP calls send `X-Actor: claude`; everything else is the user. */
export function actorOf(req: Request): Actor {
  return req.get('x-actor') === 'claude' ? 'claude' : 'user';
}

export async function logActivity(entry: {
  actor: Actor;
  type: string;
  summary: string;
  project_id?: string | null;
  task_id?: string | null;
  task_title?: string | null;
  detail?: unknown;
}) {
  await db.insert(activity).values({
    id: uuidv4(),
    created_at: new Date().toISOString(),
    actor: entry.actor,
    type: entry.type,
    summary: entry.summary,
    project_id: entry.project_id ?? null,
    task_id: entry.task_id ?? null,
    task_title: entry.task_title ?? null,
    detail: entry.detail === undefined ? null : JSON.stringify(entry.detail),
  }).run();
}
```

- [ ] **Step 7: Extend `shared/types.ts`.**
  - At the top of the file add:
```ts
import type { DocKey, DocRowResult, DocStatus } from './doc-matrix';
export type { DocKey, DocRowResult, DocStatus } from './doc-matrix';

export type DocsStage = 'proposal' | 'roadmap' | 'not_pursued';
export type Decision = 'go' | 'no_go' | 'parked';
export type DocMode = 'full' | 'one_pager_only';
```
  - In `interface Project`, add after `updated_at`:
```ts
  roadmap_item_id?: string | null;
  team?: string | null;
  docs_stage?: DocsStage | null;
  decision?: Decision | null;
  decision_date?: string | null;
  decision_reason?: string | null;
  revisit_by?: string | null;
  doc_mode?: DocMode;
  customer_facing?: boolean;
  waivers?: Partial<Record<DocKey, string>>;
  hub_url?: string | null;
  one_pager_url?: string | null;
  dev_start_half?: string | null;
  roadmap_stage?: string | null;
```
  - In `interface Task`, add after `doc_type`:
```ts
  doc_key?: DocKey | null;
  doc_status?: DocStatus | null;
  due_rule?: string | null;
```
  - Append at the end of the file:
```ts
export interface ProjectDocsInput {
  roadmap_item_id?: string | null;
  docs_stage?: DocsStage | null;
  team?: string | null;
  decision?: Decision | null;
  decision_reason?: string | null;
  revisit_by?: string | null;
  doc_mode?: DocMode;
  customer_facing?: boolean;
  waivers?: Partial<Record<DocKey, string>>;
  hub_url?: string | null;
  one_pager_url?: string | null;
}

export interface DocHealthProject {
  project_id: string;
  name: string;
  team: string | null;
  half: string | null;
  roadmap_stage: string | null;
  roadmap_item_id: string | null;
  hub_url: string | null;
  docs_stage: DocsStage;
  decision: Decision | null;
  flags: string[];
  rows: DocRowResult[];
}

export interface DocHealthResponse {
  today: string;
  summary: Record<DocStatus, number>;
  projects: DocHealthProject[];
}
```

- [ ] **Step 8: Run the verification and commit.**
Run: `npm --prefix backend test && npx tsc --noEmit -p backend` → all pass, exit 0.
```bash
git add backend/src/db shared/types.ts backend/src/lib/activity.ts backend/src/test/migrate.test.ts
git commit -m "feat(db): roadmap_items, activity, doc-system columns and doc_key backfill"
```

---

### Task 5: Roadmap sync API

**Goal:** Claude can push a roadmap snapshot (MCP `list_roadmap_items` output) into `roadmap_items`. The response suggests matches to existing projects but never links them.

**Files:**
- Create: `backend/src/routes/roadmap.ts`, `backend/src/test/helpers.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/src/test/roadmap.test.ts`

**Acceptance Criteria:**
- [ ] `POST /api/roadmap/sync {items}` upserts each item, keeps `first_seen_at` on re-sync, and returns `{ upserted, suggestions, unlinked }`.
- [ ] A suggestion is an unlinked item whose Jira key appears in an untracked or proposal project's name as `[IDEA-n]`, or whose name matches exactly (case-insensitive).
- [ ] A body without an `items` array → 400.
- [ ] `GET /api/roadmap` returns the parsed items with `project_id`.
- [ ] Each sync writes one `roadmap_synced` activity row.

**Verify:** `npm --prefix backend test -- roadmap` → pass.

**Steps:**

- [ ] **Step 1: Create the shared fixtures in `backend/src/test/helpers.ts`**
```ts
import request from 'supertest';
import app from '../index';

/** WW - Modular Elements, shaped like roadmap MCP list_roadmap_items output. */
export function modularItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ww-modular',
    name: 'WW - Modular Elements ',
    team: { id: 'team-ww', name: 'Wedding Websites', jiraAbbrev: 'DP', parentTeamId: 'team-dp' },
    stage: 'build',
    status: 'on-track',
    pm: { id: 'user-brice', name: 'Brice Fenger' },
    jiraKey: 'IDEA-932',
    links: { prd: null, figma: null, jira: 'https://minted.atlassian.net/browse/IDEA-932', jiraEpic: null, releaseNotes: null },
    phases: {
      discovery: { start: '2026-03-01', end: '2026-03-30' },
      build: { start: '2026-08-04', end: '2026-11-10' },
      measure: { start: '2026-11-10', end: '2026-12-01' },
    },
    devStartHalf: '2026-H2',
    hidden: false,
    updatedAt: '2026-10-27T19:43:27.411Z',
    ...overrides,
  };
}

export async function sync(items: unknown[]) {
  return request(app).post('/api/roadmap/sync').set('X-Actor', 'claude').send({ items });
}

export async function createProject(name: string) {
  const res = await request(app).post('/api/projects').send({ name });
  return res.body as { id: string };
}

/** Sync the Modular Elements item and link it to a new project. */
export async function linkedModularProject(itemOverrides: Record<string, unknown> = {}) {
  await sync([modularItem(itemOverrides)]);
  const p = await createProject('[IDEA-932] Header / Main Elements Flexibility');
  const res = await request(app).patch(`/api/projects/${p.id}/docs`).send({ roadmap_item_id: 'ww-modular' });
  return res.body as { id: string };
}
```

- [ ] **Step 2: Write the failing tests in `backend/src/test/roadmap.test.ts`**
```ts
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
```

- [ ] **Step 3: Run the tests and confirm they fail.** Run: `npm --prefix backend test -- roadmap` → 404s. The route and `PATCH /docs` don't exist yet; the suggestion test needs only the sync route.

- [ ] **Step 4: Create `backend/src/routes/roadmap.ts`**
```ts
import { Router, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { projects, roadmapItems, type RoadmapItemRow } from '../db/schema';
import { actorOf, logActivity } from '../lib/activity';

const router = Router();

interface RoadmapApiItem {
  id: string;
  name: string;
  team?: { id?: string; name?: string; parentTeamId?: string | null } | null;
  stage: string;
  status?: string | null;
  pm?: { name?: string } | null;
  jiraKey?: string | null;
  phases?: Record<string, unknown>;
  devStartHalf?: string | null;
  links?: Record<string, string | null>;
  hidden?: boolean;
  updatedAt?: string | null;
}

export function serializeRoadmapItem(row: RoadmapItemRow, projectId: string | null) {
  return {
    ...row,
    phases: JSON.parse(row.phases || '{}'),
    links: JSON.parse(row.links || '{}'),
    hidden: Boolean(row.hidden),
    project_id: projectId,
  };
}

// POST /api/roadmap/sync — upsert a snapshot pushed by Claude
router.post('/sync', async (req: Request, res: Response) => {
  const items: RoadmapApiItem[] | undefined = req.body?.items;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items array is required' });

  const ts = new Date().toISOString();
  for (const it of items) {
    if (!it?.id || !it?.name || !it?.stage) return res.status(400).json({ error: 'each item needs id, name, stage' });
    const existing = await db.select().from(roadmapItems).where(eq(roadmapItems.id, it.id)).get();
    const values = {
      id: it.id,
      name: it.name.trim(),
      team_id: it.team?.id ?? null,
      team_name: it.team?.name ?? null,
      parent_team_id: it.team?.parentTeamId ?? null,
      stage: it.stage,
      status: it.status ?? null,
      pm_name: it.pm?.name ?? null,
      jira_key: it.jiraKey ?? null,
      phases: JSON.stringify(it.phases ?? {}),
      dev_start_half: it.devStartHalf ?? null,
      links: JSON.stringify(it.links ?? {}),
      hidden: it.hidden ? 1 : 0,
      updated_at: it.updatedAt ?? null,
      synced_at: ts,
    };
    if (existing) {
      await db.update(roadmapItems).set(values).where(eq(roadmapItems.id, it.id)).run();
    } else {
      await db.insert(roadmapItems).values({ ...values, first_seen_at: ts }).run();
    }
  }

  const allProjects = await db.select().from(projects).where(eq(projects.status, 'active')).all();
  const linkedIds = new Set(allProjects.map((p) => p.roadmap_item_id).filter(Boolean));
  const unlinked = items.filter((it) => !linkedIds.has(it.id));
  const candidates = allProjects.filter((p) => !p.roadmap_item_id && (p.docs_stage === null || p.docs_stage === 'proposal'));

  const suggestions = unlinked.flatMap((it) => {
    const match = candidates.find((p) =>
      (it.jiraKey && p.name.includes(`[${it.jiraKey}]`)) ||
      p.name.trim().toLowerCase() === it.name.trim().toLowerCase()
    );
    return match
      ? [{ roadmap_item_id: it.id, roadmap_name: it.name.trim(), jira_key: it.jiraKey ?? null, project_id: match.id, project_name: match.name }]
      : [];
  });

  await logActivity({
    actor: actorOf(req),
    type: 'roadmap_synced',
    summary: `${items.length} roadmap items synced`,
    detail: { ids: items.map((i) => i.id) },
  });

  return res.json({
    upserted: items.length,
    suggestions,
    unlinked: unlinked.map((it) => ({ id: it.id, name: it.name.trim(), jira_key: it.jiraKey ?? null, team: it.team?.name ?? null, stage: it.stage })),
  });
});

// GET /api/roadmap
router.get('/', async (_req: Request, res: Response) => {
  const rows = await db.select().from(roadmapItems).all();
  const linked = await db.select({ id: projects.id, item: projects.roadmap_item_id }).from(projects).all();
  const byItem = new Map(linked.filter((l) => l.item).map((l) => [l.item as string, l.id]));
  res.json(rows.map((r) => serializeRoadmapItem(r, byItem.get(r.id) ?? null)));
});

export default router;
```

- [ ] **Step 5: Mount the route in `backend/src/index.ts`.** Add `import roadmapRouter from './routes/roadmap';` with the other route imports, and `app.use('/api/roadmap', roadmapRouter);` after the uploads route.

- [ ] **Step 6: Run the tests and commit.** Run: `npm --prefix backend test -- roadmap` → pass.
```bash
git add backend/src/routes/roadmap.ts backend/src/index.ts backend/src/test/helpers.ts backend/src/test/roadmap.test.ts
git commit -m "feat(api): roadmap snapshot sync with match suggestions"
```

---

### Task 6: Project doc fields API

**Goal:** Projects carry the doc-system fields. `PATCH /api/projects/:id/docs` links a roadmap item, records a decision, and sets the doc mode, waivers and URLs. The project list includes each project's half and roadmap stage.

**Files:**
- Modify: `backend/src/routes/projects.ts`
- Create: `backend/src/lib/doc-check.ts` (helpers used here and in Task 7)
- Test: `backend/src/test/projects-docs.test.ts`

**Acceptance Criteria:**
- [ ] Linking sets `docs_stage='roadmap'` and defaults `team` from the item's team name (OI/WW/ABK/DP).
- [ ] An unknown item → 400. An item already linked to another project → 409.
- [ ] Decision rules:
  - `no_go` sets `docs_stage='not_pursued'`.
  - Any new decision sets `decision_date` to today.
  - `parked` without `revisit_by` → 400.
  - A decision without `decision_reason` → 400.
- [ ] Waiver keys must be doc keys with non-empty reasons; otherwise 400.
- [ ] Responses return `waivers` as an object and `customer_facing` as a boolean. `GET /api/projects` items include `dev_start_half` and `roadmap_stage`.
- [ ] Every PATCH logs `project_docs_updated`.

**Verify:** `npm --prefix backend test -- projects-docs` → pass.

**Steps:**

- [ ] **Step 1: Write the failing tests in `backend/src/test/projects-docs.test.ts`**
```ts
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
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run: `npm --prefix backend test -- projects-docs` → 404 on PATCH.

- [ ] **Step 3: Create `backend/src/lib/doc-check.ts`**
```ts
import type { ProjectRow, TaskRow, RoadmapItemRow } from '../db/schema';
import {
  DOC_MATRIX, evaluateDocs, daysBetween,
  type DocContext, type DocEvidence, type DocKey, type RoadmapStage,
} from '../../../shared/doc-matrix';

export const TEAM_ABBREV: Record<string, string> = {
  'Online Invites': 'OI',
  'Wedding Websites': 'WW',
  'Address Book': 'ABK',
  'Digital Products': 'DP',
};

/** Today's date in the server's local time zone (the user's Mac), as YYYY-MM-DD. */
export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export function serializeProject(p: ProjectRow, item?: RoadmapItemRow) {
  return {
    ...p,
    waivers: parseJson<Record<string, string>>(p.waivers, {}),
    customer_facing: Boolean(p.customer_facing),
    dev_start_half: item?.dev_start_half ?? null,
    roadmap_stage: item?.stage ?? null,
  };
}

export function buildContext(p: ProjectRow, item: RoadmapItemRow | undefined): DocContext {
  return {
    stage: p.docs_stage === 'roadmap' && item ? (item.stage as RoadmapStage) : null,
    phases: item ? parseJson(item.phases, {}) : {},
    entered_scope_at: item?.first_seen_at ?? null,
    doc_mode: p.doc_mode,
    customer_facing: Boolean(p.customer_facing),
    waivers: parseJson(p.waivers, {}),
    decision: p.decision ?? null,
  };
}

interface PageEvidence {
  page_url?: string | null;
  published?: boolean;
  results_filled?: boolean;
}

export function buildEvidence(
  p: ProjectRow,
  item: RoadmapItemRow | undefined,
  docTasks: TaskRow[],
): Partial<Record<DocKey, DocEvidence>> {
  const links = item ? parseJson<Record<string, string | null>>(item.links, {}) : {};
  const projectLinks: Record<string, string | null> = { hub: p.hub_url, onePager: p.one_pager_url };
  const out: Partial<Record<DocKey, DocEvidence>> = {};
  for (const row of DOC_MATRIX) {
    const task = docTasks.find((t) => t.doc_key === row.key);
    const page = parseJson<PageEvidence>(task?.doc_evidence, {});
    const field = row.roadmapLink;
    out[row.key] = {
      link: field ? (links[field] ?? projectLinks[field] ?? null) : null,
      page_url: page.page_url ?? null,
      published: page.published ?? false,
      results_filled: page.results_filled ?? false,
      task_done: task?.status === 'done',
    };
  }
  return out;
}

export function projectFlags(p: ProjectRow, item: RoadmapItemRow | undefined, today: string): string[] {
  const flags: string[] = [];
  if (p.docs_stage === 'roadmap' && !item) flags.push('roadmap_item_missing');
  if (p.docs_stage === 'roadmap' && item && !p.hub_url) flags.push('no_hub');
  if (p.docs_stage === 'proposal') {
    if (!p.decision && daysBetween(p.created_at, today) > 30) flags.push('awaiting_decision');
    if (p.decision === 'go' && p.decision_date && daysBetween(p.decision_date, today) > 14) flags.push('go_not_on_roadmap');
    if (p.decision === 'parked' && p.revisit_by && p.revisit_by <= today) flags.push('revisit_due');
  }
  return flags;
}

export function projectHealth(p: ProjectRow, item: RoadmapItemRow | undefined, docTasks: TaskRow[], today: string) {
  const rows = evaluateDocs(buildContext(p, item), buildEvidence(p, item, docTasks), today);
  const flags = projectFlags(p, item, today);
  if (rows.some((r) => r.mismatch)) flags.push('link_mismatch');
  return {
    project_id: p.id,
    name: p.name,
    team: p.team,
    half: item?.dev_start_half ?? null,
    roadmap_stage: item?.stage ?? null,
    roadmap_item_id: p.roadmap_item_id,
    hub_url: p.hub_url,
    docs_stage: p.docs_stage,
    decision: p.decision ?? null,
    flags,
    rows,
  };
}
```

- [ ] **Step 4: Update `backend/src/routes/projects.ts`.**
  - Change the imports to:
```ts
import { Router, Request, Response } from 'express';
import { eq, and, ne, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import { projects, tasks, roadmapItems } from '../db/schema';
import type { CreateProjectInput, UpdateProjectInput, ProjectDocsInput } from '../../../shared/types';
import { DOC_KEYS, type DocKey } from '../../../shared/doc-matrix';
import { serializeProject, TEAM_ABBREV, todayIso } from '../lib/doc-check';
import { actorOf, logActivity } from '../lib/activity';
```
  - In `GET /`, load the roadmap items once, before the `Promise.all`:
```ts
    const items = new Map((await db.select().from(roadmapItems).all()).map((i) => [i.id, i]));
```
  - In the same handler, replace `return { ...p, task_counts: taskCounts };` with:
```ts
      const item = p.roadmap_item_id ? items.get(p.roadmap_item_id) : undefined;
      return { ...serializeProject(p, item), task_counts: taskCounts };
```
  - In `GET /:id`, replace `return res.json(project);` with:
```ts
  const item = project.roadmap_item_id
    ? await db.select().from(roadmapItems).where(eq(roadmapItems.id, project.roadmap_item_id)).get()
    : undefined;
  return res.json(serializeProject(project, item));
```
  - Add this route before `// DELETE /api/projects/:id  (archive)`:
```ts
const DOCS_STAGES = ['proposal', 'roadmap', 'not_pursued'];
const DECISIONS = ['go', 'no_go', 'parked'];
const DOC_MODES = ['full', 'one_pager_only'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// PATCH /api/projects/:id/docs
router.patch('/:id/docs', async (req: Request, res: Response) => {
  const project = await db.select().from(projects).where(eq(projects.id, req.params.id)).get();
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const body: ProjectDocsInput = req.body ?? {};
  const changes: Partial<typeof project> = {};

  if (body.roadmap_item_id !== undefined) {
    if (body.roadmap_item_id === null) {
      changes.roadmap_item_id = null;
    } else {
      const item = await db.select().from(roadmapItems).where(eq(roadmapItems.id, body.roadmap_item_id)).get();
      if (!item) return res.status(400).json({ error: 'Unknown roadmap item' });
      const other = await db.select().from(projects)
        .where(and(eq(projects.roadmap_item_id, body.roadmap_item_id), ne(projects.id, project.id))).get();
      if (other) return res.status(409).json({ error: `Roadmap item already linked to "${other.name}"` });
      changes.roadmap_item_id = item.id;
      changes.docs_stage = 'roadmap';
      if (!project.team && item.team_name && TEAM_ABBREV[item.team_name]) changes.team = TEAM_ABBREV[item.team_name];
    }
  }

  if (body.docs_stage !== undefined) {
    if (body.docs_stage !== null && !DOCS_STAGES.includes(body.docs_stage)) return res.status(400).json({ error: 'Invalid docs_stage' });
    changes.docs_stage = body.docs_stage;
  }
  if (body.team !== undefined) changes.team = body.team;

  if (body.decision !== undefined) {
    if (body.decision === null) {
      changes.decision = null;
      changes.decision_date = null;
      changes.decision_reason = null;
      changes.revisit_by = null;
    } else {
      if (!DECISIONS.includes(body.decision)) return res.status(400).json({ error: 'Invalid decision' });
      if (!body.decision_reason?.trim()) return res.status(400).json({ error: 'decision_reason is required' });
      if (body.decision === 'parked' && !(body.revisit_by && ISO_DATE.test(body.revisit_by))) {
        return res.status(400).json({ error: 'revisit_by (YYYY-MM-DD) is required when parked' });
      }
      changes.decision = body.decision;
      changes.decision_reason = body.decision_reason.trim();
      changes.decision_date = todayIso();
      changes.revisit_by = body.decision === 'parked' ? body.revisit_by! : null;
      if (body.decision === 'no_go') changes.docs_stage = 'not_pursued';
    }
  }

  if (body.doc_mode !== undefined) {
    if (!DOC_MODES.includes(body.doc_mode)) return res.status(400).json({ error: 'Invalid doc_mode' });
    changes.doc_mode = body.doc_mode;
  }
  if (body.customer_facing !== undefined) changes.customer_facing = body.customer_facing ? 1 : 0;

  if (body.waivers !== undefined) {
    for (const [key, reason] of Object.entries(body.waivers)) {
      if (!DOC_KEYS.includes(key as DocKey)) return res.status(400).json({ error: `Unknown doc key: ${key}` });
      if (typeof reason !== 'string' || !reason.trim()) return res.status(400).json({ error: `Waiver for ${key} needs a reason` });
    }
    changes.waivers = JSON.stringify(body.waivers);
  }
  if (body.hub_url !== undefined) changes.hub_url = body.hub_url;
  if (body.one_pager_url !== undefined) changes.one_pager_url = body.one_pager_url;

  const updated = { ...project, ...changes, updated_at: now() };
  await db.update(projects).set(updated).where(eq(projects.id, project.id)).run();
  await logActivity({
    actor: actorOf(req),
    type: 'project_docs_updated',
    project_id: project.id,
    summary: `Doc settings updated: ${Object.keys(changes).join(', ') || 'no changes'}`,
    detail: changes,
  });

  const item = updated.roadmap_item_id
    ? await db.select().from(roadmapItems).where(eq(roadmapItems.id, updated.roadmap_item_id)).get()
    : undefined;
  return res.json(serializeProject(updated, item));
});
```

- [ ] **Step 5: Run the tests and commit.** Run: `npm --prefix backend test` → all pass. The earlier roadmap suggestion test still passes, because projects created with defaults have `docs_stage` null.
```bash
git add backend/src/routes/projects.ts backend/src/lib/doc-check.ts backend/src/test/projects-docs.test.ts
git commit -m "feat(api): project doc settings, roadmap linking and decisions"
```

---

### Task 7: Docs health and apply API

**Goal:**
- `GET /api/docs/health` returns every tracked project's doc rows, flags and a status summary.
- `POST /api/docs/apply` upserts one task per required doc, stores page evidence, re-dates tasks when roadmap dates change, completes link-only tasks, and logs every change.

**Files:**
- Create: `backend/src/routes/docs.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/src/test/docs.test.ts`

**Acceptance Criteria:**
- [ ] First apply on Modular Elements (today 2026-10-28) creates 8 tasks. Titles are `Doc: <label>`, `doc_type` is the key before the dot, and `due_rule` is set. The PRD is due `2026-07-21`.
- [ ] A second apply creates nothing and re-dates nothing.
- [ ] After `build.start` moves to `2026-08-18`, apply re-dates the PRD from 07-21 to 08-04 and logs `doc_due_changed`.
- [ ] Evidence for the PRD plus marking its task done → health shows `prd` as `done`.
- [ ] A link-only row with its link set → apply marks the task done and lists it in `completed`.
- [ ] Health filters by `team`, `half`, `status` and `project_id`, accepts `today`, and excludes untracked and `not_pursued` projects.
- [ ] Apply on an untracked project → 400.

**Verify:** `npm --prefix backend test -- docs` → pass.

**Steps:**

- [ ] **Step 1: Write the failing tests in `backend/src/test/docs.test.ts`**
```ts
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
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run: `npm --prefix backend test -- docs` → 404s.

- [ ] **Step 3: Create `backend/src/routes/docs.ts`**
```ts
import { Router, Request, Response } from 'express';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import { projects, tasks, roadmapItems } from '../db/schema';
import { DOC_STATUSES, docRow, evaluateDocs, type DocKey, type DocStatus } from '../../../shared/doc-matrix';
import { buildContext, buildEvidence, projectHealth, todayIso } from '../lib/doc-check';
import { actorOf, logActivity } from '../lib/activity';

const router = Router();

// GET /api/docs/health?half=&team=&status=&project_id=&today=
router.get('/health', async (req: Request, res: Response) => {
  const q = (k: string) => (typeof req.query[k] === 'string' && req.query[k] !== '' ? String(req.query[k]) : undefined);
  const today = q('today') ?? todayIso();

  const tracked = await db.select().from(projects)
    .where(and(eq(projects.status, 'active'), inArray(projects.docs_stage, ['proposal', 'roadmap'])))
    .all();
  const items = new Map((await db.select().from(roadmapItems).all()).map((i) => [i.id, i]));
  const docTasks = await db.select().from(tasks).where(isNotNull(tasks.doc_key)).all();

  let result = tracked.map((p) =>
    projectHealth(p, p.roadmap_item_id ? items.get(p.roadmap_item_id) : undefined, docTasks.filter((t) => t.project_id === p.id), today)
  );

  const projectId = q('project_id');
  const team = q('team');
  const half = q('half');
  const status = q('status');
  if (projectId) result = result.filter((p) => p.project_id === projectId);
  if (team) result = result.filter((p) => p.team === team);
  if (half) result = result.filter((p) => p.half === half);
  if (status) result = result.filter((p) => p.rows.some((r) => r.status === status));

  const overdue = (p: (typeof result)[number]) => p.rows.filter((r) => r.status === 'overdue').length;
  result.sort((a, b) => overdue(b) - overdue(a) || a.name.localeCompare(b.name));

  const summary = Object.fromEntries(DOC_STATUSES.map((s) => [s, 0])) as Record<DocStatus, number>;
  for (const p of result) for (const r of p.rows) summary[r.status] += 1;

  res.json({ today, summary, projects: result });
});

interface PageEvidenceInput {
  page_url?: string | null;
  published?: boolean;
  results_filled?: boolean;
}

// POST /api/docs/apply { project_id, evidence?, today? }
router.post('/apply', async (req: Request, res: Response) => {
  const { project_id, evidence = {}, today: todayParam } = req.body ?? {};
  const evidenceIn = evidence as Partial<Record<DocKey, PageEvidenceInput>>;
  const today: string = todayParam ?? todayIso();
  const actor = actorOf(req);

  const p = await db.select().from(projects).where(eq(projects.id, project_id)).get();
  if (!p) return res.status(404).json({ error: 'Project not found' });
  if (p.docs_stage !== 'proposal' && p.docs_stage !== 'roadmap') {
    return res.status(400).json({ error: 'Project is not tracked by the doc system' });
  }
  const item = p.roadmap_item_id
    ? await db.select().from(roadmapItems).where(eq(roadmapItems.id, p.roadmap_item_id)).get()
    : undefined;

  const loadDocTasks = () =>
    db.select().from(tasks).where(and(eq(tasks.project_id, p.id), isNotNull(tasks.doc_key))).all();

  const created: { id: string; doc_key: DocKey; due_date: string | null }[] = [];
  const redated: { id: string; doc_key: DocKey; from: string | null; to: string | null }[] = [];
  const completed: { id: string; doc_key: DocKey }[] = [];
  const ts = new Date().toISOString();

  // Pass 1: upsert one task per required row, store evidence, re-date.
  const required = evaluateDocs(buildContext(p, item), {}, today);
  let docTasks = await loadDocTasks();
  const maxPos = await db.select({ max: sql<number>`coalesce(max(${tasks.position}), -1)` })
    .from(tasks).where(and(eq(tasks.project_id, p.id), eq(tasks.status, 'todo'))).get();
  let position = Number(maxPos?.max ?? -1) + 1;

  for (const r of required) {
    const task = docTasks.find((t) => t.doc_key === r.key);
    const ev = evidenceIn[r.key];
    if (!task) {
      if (r.status === 'waived' && !ev) continue;
      const id = uuidv4();
      const title = `Doc: ${r.label}`;
      await db.insert(tasks).values({
        id, project_id: p.id, title,
        description: `Required by the doc matrix (${r.due_rule}).`,
        status: 'todo', priority: 'medium', due_date: r.due, position: position++,
        images: '[]', links: '[]', doc_type: r.key.split('.')[0],
        doc_key: r.key, doc_status: null, due_rule: r.due_rule,
        doc_evidence: ev ? JSON.stringify(ev) : null,
        source: 'manual', slack_raw: null, created_at: ts, updated_at: ts,
      }).run();
      created.push({ id, doc_key: r.key, due_date: r.due });
      await logActivity({ actor, type: 'doc_task_created', project_id: p.id, task_id: id, task_title: title,
        summary: `Created "${title}" due ${r.due ?? 'undated'}`, detail: { doc_key: r.key, due_rule: r.due_rule } });
      continue;
    }
    const set: Partial<typeof task> = { due_rule: r.due_rule };
    if (ev) set.doc_evidence = JSON.stringify(ev);
    if (task.due_date !== r.due) {
      set.due_date = r.due;
      redated.push({ id: task.id, doc_key: r.key, from: task.due_date, to: r.due });
      await logActivity({ actor, type: 'doc_due_changed', project_id: p.id, task_id: task.id, task_title: task.title,
        summary: `Due date ${task.due_date ?? 'none'} → ${r.due ?? 'none'} (${r.due_rule})`,
        detail: { doc_key: r.key, from: task.due_date, to: r.due } });
    }
    await db.update(tasks).set({ ...set, updated_at: ts }).where(eq(tasks.id, task.id)).run();
  }

  // Pass 2: compute statuses with evidence; persist; complete link-only rows.
  docTasks = await loadDocTasks();
  const rows = evaluateDocs(buildContext(p, item), buildEvidence(p, item, docTasks), today);
  for (const t of docTasks) {
    const r = rows.find((x) => x.key === t.doc_key);
    const status: DocStatus = r ? r.status : 'waived';
    const set: Partial<typeof t> = { doc_status: status };
    if (r && docRow(r.key).linkOnly && r.status === 'done' && t.status !== 'done') {
      set.status = 'done';
      completed.push({ id: t.id, doc_key: r.key });
      await logActivity({ actor, type: 'doc_task_completed', project_id: p.id, task_id: t.id, task_title: t.title,
        summary: `Completed "${t.title}" (link set)`, detail: { doc_key: r.key, link: r.link } });
    }
    await db.update(tasks).set(set).where(eq(tasks.id, t.id)).run();
  }

  return res.json({ rows, created, redated, completed });
});

export default router;
```

- [ ] **Step 4: Mount the route in `backend/src/index.ts`.** Add `import docsRouter from './routes/docs';` and `app.use('/api/docs', docsRouter);`.

- [ ] **Step 5: Return the new task fields from the tasks API.** Check `backend/src/routes/tasks.ts`: `parseTaskRow` spreads the row, so `doc_key`, `doc_status` and `due_rule` are already returned. No change is needed. Confirm by running the tests.

- [ ] **Step 6: Run the verification and commit.** Run: `npm --prefix backend test && npx tsc --noEmit -p backend` → all pass.
```bash
git add backend/src/routes/docs.ts backend/src/index.ts backend/src/test/docs.test.ts
git commit -m "feat(api): docs health grid and apply (upsert doc tasks, re-date, log)"
```

---

### Task 8: MCP tools

**Goal:** Claude can sync the roadmap, read doc health, apply check results, record decisions and link projects. Each write is tagged `X-Actor: claude`.

**Files:**
- Modify: `mcp-server/src/index.ts`

**Acceptance Criteria:**
- [ ] New tools `sync_roadmap`, `get_doc_health`, `apply_doc_check`, `set_project_decision` and `link_project` are registered.
- [ ] Every API call sends `X-Actor: claude`.
- [ ] `link_project`'s description says it may only be called after the user approves the match.
- [ ] `npm --prefix mcp-server run build` succeeds.

**Verify:** `npm --prefix mcp-server run build` → exit 0. Then, with the backend running (`npm run dev:backend`), run `curl -s localhost:3001/api/docs/health | head -c 200` → JSON.

**Steps:**

- [ ] **Step 1: Tag the actor.** In `api()`, change the headers line to:
```ts
    headers: { "Content-Type": "application/json", "X-Actor": "claude" },
```

- [ ] **Step 2: Add helpers** after the `api` function:
```ts
function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(e: any) {
  return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
}
```

- [ ] **Step 3: Register the tools** just before `async function main()`:
```ts
// --- Doc system ---

server.tool(
  "sync_roadmap",
  "Push a roadmap snapshot into TaskManager. Pass the `items` array exactly as returned by the roadmap MCP's list_roadmap_items. Returns suggested project matches (never applied automatically) and unlinked items.",
  { items: z.array(z.record(z.any())).describe("Items from roadmap list_roadmap_items") },
  async ({ items }) => {
    try {
      return ok(await api("/roadmap/sync", { method: "POST", body: JSON.stringify({ items }) }));
    } catch (e: any) {
      return fail(e);
    }
  }
);

server.tool(
  "get_doc_health",
  "Doc status for every tracked project: required docs, due dates, statuses (done, draft, due_soon, overdue, missing, waived, cant_date, inactive) and flags.",
  {
    half: z.string().optional().describe('e.g. "2026-H2"'),
    team: z.string().optional().describe("OI, WW, ABK or DP"),
    status: z.string().optional().describe("Only projects with at least one row in this status"),
    project_id: z.string().optional(),
  },
  async (params) => {
    try {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v) as [string, string][]
      ).toString();
      return ok(await api(`/docs/health${qs ? `?${qs}` : ""}`));
    } catch (e: any) {
      return fail(e);
    }
  }
);

server.tool(
  "apply_doc_check",
  "Apply the doc check to one project: creates missing doc tasks, re-dates them from roadmap dates, stores Confluence page evidence, completes link-only docs. Safe to repeat.",
  {
    project_id: z.string(),
    evidence: z
      .record(
        z.object({
          page_url: z.string().nullable().optional(),
          published: z.boolean().optional(),
          results_filled: z.boolean().optional(),
        })
      )
      .optional()
      .describe("Per doc_key: the hub child page found in Confluence"),
  },
  async ({ project_id, evidence }) => {
    try {
      return ok(await api("/docs/apply", { method: "POST", body: JSON.stringify({ project_id, evidence }) }));
    } catch (e: any) {
      return fail(e);
    }
  }
);

server.tool(
  "set_project_decision",
  "Record the one-pager decision for a proposal. no_go stops all later doc requirements; parked needs revisit_by.",
  {
    project_id: z.string(),
    decision: z.enum(["go", "no_go", "parked"]),
    reason: z.string().describe("One-line reason"),
    revisit_by: z.string().optional().describe("YYYY-MM-DD, required for parked"),
  },
  async ({ project_id, decision, reason, revisit_by }) => {
    try {
      return ok(await api(`/projects/${project_id}/docs`, {
        method: "PATCH",
        body: JSON.stringify({ decision, decision_reason: reason, revisit_by }),
      }));
    } catch (e: any) {
      return fail(e);
    }
  }
);

server.tool(
  "link_project",
  "Set a project's doc-system fields: roadmap item link, hub/one-pager URLs, team, doc mode, customer-facing flag, waivers, docs_stage. Only link a roadmap item after the user has approved that match.",
  {
    project_id: z.string(),
    roadmap_item_id: z.string().nullable().optional(),
    docs_stage: z.enum(["proposal", "roadmap", "not_pursued"]).nullable().optional(),
    hub_url: z.string().nullable().optional(),
    one_pager_url: z.string().nullable().optional(),
    team: z.string().nullable().optional(),
    doc_mode: z.enum(["full", "one_pager_only"]).optional(),
    customer_facing: z.boolean().optional(),
    waivers: z.record(z.string()).optional().describe("doc_key → reason"),
  },
  async ({ project_id, ...fields }) => {
    try {
      return ok(await api(`/projects/${project_id}/docs`, { method: "PATCH", body: JSON.stringify(fields) }));
    } catch (e: any) {
      return fail(e);
    }
  }
);
```

- [ ] **Step 4: Build and commit.** Run: `npm --prefix mcp-server run build` → exit 0.
```bash
git add mcp-server/src/index.ts
git commit -m "feat(mcp): doc system tools (sync_roadmap, get_doc_health, apply_doc_check, set_project_decision, link_project)"
```

---

### Task 9: Docs panel on the project page

**Goal:** Each project page shows its doc checklist above the board.
- **Roadmap projects:** half, team, stage, hub link, a one-pager-only switch, and one row per doc with its status chip, due date and rule.
- **Proposals:** the Go / No-go / Parked buttons.
- **Untracked projects:** a "Track as proposal" button.

**Files:**
- Modify: `frontend/src/api/client.ts`, `frontend/src/utils/index.ts`, `frontend/src/components/projects/ProjectDetail.tsx`
- Create: `frontend/src/components/docs/DocStatusChip.tsx`, `frontend/src/components/docs/DocsPanel.tsx`

**Acceptance Criteria:**
- [ ] `npx tsc -b` and `npx vite build` pass.
- [ ] Linked project: rows match `GET /api/docs/health?project_id=…`.
- [ ] Toggling one-pager-only removes the Brief/PRD row.

**Verify:** `cd frontend && npx tsc -b && npx vite build` → exit 0. Then the manual check in Step 6.

**Steps:**

- [ ] **Step 1: Add the API calls to `frontend/src/api/client.ts`.** Insert before `// Dashboard`:
```ts
  // Docs
  getDocHealth: (params: { half?: string; team?: string; status?: string; project_id?: string } = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v) as [string, string][]
    ).toString();
    return request<import('@shared/types').DocHealthResponse>(`/docs/health${qs ? `?${qs}` : ''}`);
  },
  updateProjectDocs: (id: string, data: import('@shared/types').ProjectDocsInput) =>
    request<import('@shared/types').Project>(`/projects/${id}/docs`, { method: 'PATCH', body: JSON.stringify(data) }),

```

- [ ] **Step 2: Add `halfLabel` to `frontend/src/utils/index.ts`** (append):
```ts
/** "2026-H2" → "H2'26"; anything else → "Unscheduled". */
export function halfLabel(half: string | null | undefined): string {
  const m = half?.match(/^(\d{4})-H([12])$/);
  return m ? `H${m[2]}'${m[1].slice(2)}` : 'Unscheduled';
}
```

- [ ] **Step 3: Create `frontend/src/components/docs/DocStatusChip.tsx`**
```tsx
import type { DocStatus } from '@shared/types';

export const DOC_STATUS_META: Record<DocStatus, { icon: string; label: string; className: string }> = {
  done: { icon: '✅', label: 'Done', className: 'bg-green-50 text-green-700 border-green-200' },
  draft: { icon: '📝', label: 'Draft', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  review: { icon: '📄', label: 'Published — tick task', className: 'bg-sky-50 text-sky-700 border-sky-200' },
  due_soon: { icon: '⏳', label: 'Due soon', className: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
  overdue: { icon: '🔴', label: 'Overdue', className: 'bg-red-50 text-red-700 border-red-200' },
  missing: { icon: '⚪', label: 'Missing', className: 'bg-slate-50 text-slate-600 border-slate-200' },
  waived: { icon: '➖', label: 'Not required', className: 'bg-slate-50 text-slate-400 border-slate-200' },
  cant_date: { icon: '❓', label: "Can't date", className: 'bg-purple-50 text-purple-700 border-purple-200' },
  inactive: { icon: '·', label: 'Later', className: 'bg-white text-slate-300 border-slate-100' },
};

export const FLAG_LABELS: Record<string, string> = {
  no_hub: 'No hub page',
  roadmap_item_missing: 'Gone from roadmap',
  awaiting_decision: 'Awaiting decision',
  go_not_on_roadmap: 'Go, not on roadmap',
  revisit_due: 'Revisit due',
  link_mismatch: 'Link mismatch',
};

export function DocStatusChip({ status, compact = false, title }: { status: DocStatus; compact?: boolean; title?: string }) {
  const meta = DOC_STATUS_META[status];
  return (
    <span
      title={title ?? meta.label}
      className={`inline-flex items-center gap-1 border rounded-full text-xs ${compact ? 'px-1.5 py-0.5' : 'px-2 py-0.5'} ${meta.className}`}
    >
      <span>{meta.icon}</span>
      {!compact && <span>{meta.label}</span>}
    </span>
  );
}

export function FlagChips({ flags }: { flags: string[] }) {
  if (flags.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {flags.map((f) => (
        <span key={f} className="text-[11px] bg-orange-50 text-orange-700 border border-orange-200 rounded px-1.5 py-0.5">
          {FLAG_LABELS[f] ?? f}
        </span>
      ))}
    </span>
  );
}
```

- [ ] **Step 4: Create `frontend/src/components/docs/DocsPanel.tsx`**
```tsx
import { useCallback, useEffect, useState } from 'react';
import type { Decision, DocHealthProject, Project, ProjectDocsInput } from '@shared/types';
import { api } from '../../api/client';
import { formatDate, halfLabel } from '../../utils';
import { DocStatusChip, FlagChips } from './DocStatusChip';

const DECISION_LABELS: Record<Decision, string> = { go: 'Go', no_go: 'No-go', parked: 'Parked' };

export function DocsPanel({ project }: { project: Project }) {
  const [current, setCurrent] = useState<Project>(project);
  const [health, setHealth] = useState<DocHealthProject | null>(null);
  const [open, setOpen] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => setCurrent(project), [project]);

  const load = useCallback(async (p: Project) => {
    if (p.docs_stage !== 'proposal' && p.docs_stage !== 'roadmap') {
      setHealth(null);
      return;
    }
    const res = await api.getDocHealth({ project_id: p.id });
    setHealth(res.projects[0] ?? null);
  }, []);

  useEffect(() => {
    load(current).catch((e) => setError((e as Error).message));
  }, [current, load]);

  const update = async (data: ProjectDocsInput) => {
    setError('');
    try {
      setCurrent(await api.updateProjectDocs(current.id, data));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const decide = async (decision: Decision) => {
    const reason = window.prompt(`Reason for "${DECISION_LABELS[decision]}"?`)?.trim();
    if (!reason) return;
    let revisit_by: string | undefined;
    if (decision === 'parked') {
      revisit_by = window.prompt('Revisit by (YYYY-MM-DD)?')?.trim();
      if (!revisit_by || !/^\d{4}-\d{2}-\d{2}$/.test(revisit_by)) {
        setError('Revisit date must be YYYY-MM-DD');
        return;
      }
    }
    await update({ decision, decision_reason: reason, revisit_by });
  };

  if (!current.docs_stage) {
    return (
      <div className="bg-white border-b border-slate-200 px-8 py-2 text-sm text-slate-500 flex items-center gap-3">
        <span>Not tracked by the doc system.</span>
        <button onClick={() => update({ docs_stage: 'proposal' })} className="text-indigo-600 hover:underline">
          Track as proposal
        </button>
        {error && <span className="text-red-600">{error}</span>}
      </div>
    );
  }

  if (current.docs_stage === 'not_pursued') {
    return (
      <div className="bg-white border-b border-slate-200 px-8 py-2 text-sm text-slate-500">
        Not pursued{current.decision_date ? ` (${formatDate(current.decision_date)})` : ''}: {current.decision_reason}
      </div>
    );
  }

  return (
    <div className="bg-white border-b border-slate-200 px-8 py-3">
      <div className="flex items-center gap-3 text-sm">
        <button onClick={() => setOpen(!open)} className="font-semibold text-slate-700 flex items-center gap-1">
          <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          Docs
        </button>
        {current.docs_stage === 'roadmap' ? (
          <span className="text-slate-500">
            {halfLabel(health?.half)} · {current.team ?? '—'} · {health?.roadmap_stage ?? '—'}
          </span>
        ) : (
          <span className="text-slate-500">
            Proposal{current.decision ? ` · ${DECISION_LABELS[current.decision]}` : ''}
            {current.revisit_by ? ` · revisit ${formatDate(current.revisit_by)}` : ''}
          </span>
        )}
        {current.hub_url && (
          <a href={current.hub_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">Hub</a>
        )}
        {health && <FlagChips flags={health.flags} />}
        {current.docs_stage === 'roadmap' && (
          <label className="ml-auto flex items-center gap-1.5 text-slate-500">
            <input
              type="checkbox"
              checked={current.doc_mode === 'one_pager_only'}
              onChange={(e) => update({ doc_mode: e.target.checked ? 'one_pager_only' : 'full' })}
            />
            One-pager only
          </label>
        )}
        {current.docs_stage === 'proposal' && (
          <div className="ml-auto flex gap-1">
            {(['go', 'no_go', 'parked'] as Decision[]).map((d) => (
              <button
                key={d}
                onClick={() => decide(d)}
                className={`px-2.5 py-1 rounded border text-xs ${current.decision === d ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                {DECISION_LABELS[d]}
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
      {open && health && (
        <table className="mt-2 w-full text-sm">
          <tbody>
            {health.rows.map((r) => (
              <tr key={r.key} className="border-t border-slate-100">
                <td className="py-1.5 pr-4 text-slate-700">
                  {r.link ? <a href={r.link} target="_blank" rel="noreferrer" className="hover:underline">{r.label}</a> : r.label}
                </td>
                <td className="py-1.5 pr-4 text-slate-500 whitespace-nowrap">{r.due ? formatDate(r.due) : '—'}</td>
                <td className="py-1.5 pr-4 text-slate-400 whitespace-nowrap">{r.due_rule}</td>
                <td className="py-1.5"><DocStatusChip status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Render the panel in `ProjectDetail.tsx`.**
  - Add `import { DocsPanel } from '../docs/DocsPanel';` after the `SlackPasteModal` import.
  - Insert `{project && <DocsPanel project={project} />}` directly above `{/* Content */}`.

- [ ] **Step 6: Verify and commit.**
  - Run: `cd frontend && npx tsc -b && npx vite build` → exit 0.
  - Manual check: run `./start.sh` (or `npm run dev:backend` and `npm run dev:frontend`) and open a project.
    - An untracked project shows "Track as proposal".
    - A project linked via `curl -X PATCH localhost:3001/api/projects/<id>/docs -H 'Content-Type: application/json' -d '{"roadmap_item_id":"<id>"}'`, after a sync, shows rows.
```bash
git add frontend/src/api/client.ts frontend/src/utils/index.ts frontend/src/components/docs frontend/src/components/projects/ProjectDetail.tsx
git commit -m "feat(ui): project docs panel with status chips, decisions and one-pager-only"
```

---

### Task 10: Docs grid page

**Goal:** `/docs` shows projects × docs, grouped Half → Team, with Proposals last. It filters by team and status, and each cell is a status chip with its due date in the tooltip.

**Files:**
- Create: `frontend/src/components/docs/DocsPage.tsx`
- Modify: `frontend/src/App.tsx`

**Acceptance Criteria:**
- [ ] Groups appear in chronological half order (`2026-H1`, `2026-H2`, `2027-H1`), then Unscheduled, then Proposals. Teams are sorted within each group.
- [ ] Columns follow `DOC_MATRIX` order. A cell is blank when the doc isn't required.
- [ ] Filters call `/api/docs/health` with `team` and `status`.

**Verify:** `cd frontend && npx tsc -b && npx vite build` → exit 0. Then open `/docs` manually.

**Steps:**

- [ ] **Step 1: Create `frontend/src/components/docs/DocsPage.tsx`**
```tsx
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DocHealthProject, DocHealthResponse, DocStatus } from '@shared/types';
import { DOC_MATRIX } from '@shared/doc-matrix';
import { api } from '../../api/client';
import { formatDate, halfLabel } from '../../utils';
import { DOC_STATUS_META, DocStatusChip, FlagChips } from './DocStatusChip';

const TEAMS = ['OI', 'WW', 'ABK', 'DP'];
const STATUS_FILTERS: DocStatus[] = ['overdue', 'due_soon', 'missing', 'cant_date', 'draft', 'review'];
const COLUMN_LABELS: Record<string, string> = {
  hub: 'Hub', one_pager: '1-pager', research: 'Research', prd: 'PRD', figma: 'Figma',
  'experiment_brief.plan': 'Exp plan', jira_epic: 'Epic', cs_marketing_brief: 'CS/Mkt',
  release_notes: 'Rel notes', metrics_snapshot: 'Metrics', 'experiment_brief.results': 'Exp results',
};

type Group = { key: string; label: string; teams: [string, DocHealthProject[]][] };

function groupProjects(projects: DocHealthProject[]): Group[] {
  const groups = new Map<string, Map<string, DocHealthProject[]>>();
  for (const p of projects) {
    const key = p.docs_stage === 'proposal' ? 'zz-proposals' : p.half ?? 'zy-unscheduled';
    const teams = groups.get(key) ?? new Map<string, DocHealthProject[]>();
    const team = p.team ?? '—';
    teams.set(team, [...(teams.get(team) ?? []), p]);
    groups.set(key, teams);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, teams]) => ({
      key,
      label: key === 'zz-proposals' ? 'Proposals' : halfLabel(key),
      teams: [...teams.entries()].sort(([a], [b]) => a.localeCompare(b)),
    }));
}

export function DocsPage() {
  const [data, setData] = useState<DocHealthResponse | null>(null);
  const [team, setTeam] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    api.getDocHealth({ team, status }).then(setData).catch((e) => setError((e as Error).message));
  }, [team, status]);

  const groups = useMemo(() => groupProjects(data?.projects ?? []), [data]);

  return (
    <div className="p-8">
      <div className="flex items-center gap-4 mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Docs</h2>
        <select value={team} onChange={(e) => setTeam(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1 text-sm">
          <option value="">All teams</option>
          {TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1 text-sm">
          <option value="">Any status</option>
          {STATUS_FILTERS.map((s) => <option key={s} value={s}>{DOC_STATUS_META[s].icon} {DOC_STATUS_META[s].label}</option>)}
        </select>
        {data && (
          <span className="ml-auto text-sm text-slate-500 flex gap-3">
            {STATUS_FILTERS.map((s) => <span key={s}>{DOC_STATUS_META[s].icon} {data.summary[s]}</span>)}
          </span>
        )}
      </div>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
      {data && data.projects.length === 0 && <p className="text-slate-500">No tracked projects match.</p>}

      {groups.map((g) => (
        <section key={g.key} className="mb-8">
          <h3 className="font-semibold text-slate-700 mb-2">{g.label}</h3>
          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-slate-200">
                  <th className="text-left font-medium px-4 py-2 w-72">Project</th>
                  {DOC_MATRIX.map((r) => (
                    <th key={r.key} className="font-medium px-2 py-2 whitespace-nowrap">{COLUMN_LABELS[r.key]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.teams.map(([teamName, projects]) => (
                  <TeamRows key={teamName} team={teamName} projects={projects} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function TeamRows({ team, projects }: { team: string; projects: DocHealthProject[] }) {
  return (
    <>
      <tr className="bg-slate-50">
        <td colSpan={DOC_MATRIX.length + 1} className="px-4 py-1 text-xs font-semibold text-slate-500">{team}</td>
      </tr>
      {projects.map((p) => (
        <tr key={p.project_id} className="border-t border-slate-100">
          <td className="px-4 py-2">
            <Link to={`/projects/${p.project_id}`} className="text-slate-800 hover:text-indigo-600">{p.name}</Link>
            <div className="mt-0.5"><FlagChips flags={p.flags} /></div>
          </td>
          {DOC_MATRIX.map((col) => {
            const row = p.rows.find((r) => r.key === col.key);
            return (
              <td key={col.key} className="px-2 py-2 text-center">
                {row && (
                  <DocStatusChip
                    compact
                    status={row.status}
                    title={`${row.label}: ${DOC_STATUS_META[row.status].label}${row.due ? ` · due ${formatDate(row.due)}` : ''} (${row.due_rule})`}
                  />
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
```

- [ ] **Step 2: Add the route in `frontend/src/App.tsx`.**
  - Add `import { DocsPage } from './components/docs/DocsPage';`.
  - Add `<Route path="/docs" element={<DocsPage />} />` after the `/` route.

- [ ] **Step 3: Verify and commit.**
  - Run: `cd frontend && npx tsc -b && npx vite build` → exit 0.
  - Manual check: open `http://localhost:5173/docs` and confirm the groups and chips render.
```bash
git add frontend/src/components/docs/DocsPage.tsx frontend/src/App.tsx
git commit -m "feat(ui): /docs grid grouped by half and team"
```

---

### Task 11: Sidebar grouping and dashboard card

**Goal:**
- **Sidebar:** a "Docs" link, plus projects grouped by Half → Team, then Proposals, Other and a collapsed Not Pursued group.
- **Dashboard:** a Project docs card with overdue, due-soon, missing and can't-date counts, linking to `/docs`.

**Files:**
- Modify: `frontend/src/components/layout/Sidebar.tsx`, `frontend/src/components/dashboard/Dashboard.tsx`

**Acceptance Criteria:**
- [ ] Group order: halves newest first (e.g. H1'27, H2'26, H1'26), then Proposals, Other, then Not Pursued (collapsed by default). There's a team sub-heading wherever a team is set.
- [ ] The archived-projects section from Task 0 still works.
- [ ] The dashboard card renders when `/api/docs/health` responds and is hidden when it fails.

**Verify:** `cd frontend && npx tsc -b && npx vite build` → exit 0. Then check the sidebar and dashboard manually.

**Steps:**

- [ ] **Step 1: Update `Sidebar.tsx`.**
  - Change the imports to:
```tsx
import { Link, useLocation } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useEffect, useState } from 'react';
import type { Project } from '@shared/types';
import { halfLabel } from '../../utils';
```
  - Add these module-level helpers below the imports:
```tsx
type SidebarGroup = { key: string; label: string; teams: [string, Project[]][] };

function groupSidebarProjects(projects: Project[]): SidebarGroup[] {
  const groups = new Map<string, Map<string, Project[]>>();
  for (const p of projects) {
    const key =
      p.docs_stage === 'not_pursued' ? '4-not-pursued'
      : p.docs_stage === 'proposal' ? '2-proposals'
      : p.dev_start_half ? `1-${p.dev_start_half}`
      : '3-other';
    const teams = groups.get(key) ?? new Map<string, Project[]>();
    const team = p.team ?? '';
    teams.set(team, [...(teams.get(team) ?? []), p]);
    groups.set(key, teams);
  }
  const label = (key: string) =>
    key === '2-proposals' ? 'Proposals' : key === '3-other' ? 'Other' : key === '4-not-pursued' ? 'Not Pursued' : halfLabel(key.slice(2));
  return [...groups.entries()]
    .sort(([a], [b]) => {
      const ra = a.startsWith('1-') ? 1 : 2;
      const rb = b.startsWith('1-') ? 1 : 2;
      if (ra !== rb) return ra - rb;
      return ra === 1 ? b.localeCompare(a) : a.localeCompare(b);
    })
    .map(([key, teams]) => ({
      key,
      label: label(key),
      teams: [...teams.entries()].sort(([a], [b]) => a.localeCompare(b)),
    }));
}

function ProjectLink({ project, active }: { project: Project; active: boolean }) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
        active ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
      }`}
    >
      <span className="w-2 h-2 rounded-full bg-indigo-400 flex-shrink-0" />
      <span className="truncate">{project.name}</span>
      {project.task_counts && project.task_counts.todo + project.task_counts.in_progress > 0 && (
        <span className="ml-auto text-xs bg-slate-700 text-slate-300 rounded-full px-1.5 py-0.5">
          {project.task_counts.todo + project.task_counts.in_progress}
        </span>
      )}
    </Link>
  );
}
```
  - Inside `Sidebar()`, after `const [showArchived, setShowArchived] = useState(false);`, add:
```tsx
  const [showNotPursued, setShowNotPursued] = useState(false);
  const groups = groupSidebarProjects(state.projects);
```
  - Directly after the Dashboard `<Link>…</Link>` (still inside its `<div className="px-3 mb-2">`), add a Docs link:
```tsx
          <Link
            to="/docs"
            className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              location.pathname === '/docs' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Docs
          </Link>
```
  - Replace the whole `{state.projects.map((project) => ( <Link …>…</Link> ))}` block with:
```tsx
          {groups.map((g) => {
            const collapsed = g.key === '4-not-pursued' && !showNotPursued;
            return (
              <div key={g.key} className="mt-3">
                {g.key === '4-not-pursued' ? (
                  <button onClick={() => setShowNotPursued(!showNotPursued)} className="px-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    {showNotPursued ? '▾' : '▸'} {g.label}
                  </button>
                ) : (
                  <p className="px-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{g.label}</p>
                )}
                {!collapsed && g.teams.map(([team, projects]) => (
                  <div key={team || 'none'}>
                    {team && <p className="px-3 mt-1 text-[11px] text-slate-500">{team}</p>}
                    {projects.map((project) => (
                      <ProjectLink
                        key={project.id}
                        project={project}
                        active={location.pathname.startsWith(`/projects/${project.id}`)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            );
          })}
```

- [ ] **Step 2: Add the dashboard card in `Dashboard.tsx`.**
  - Change the first line to `import { useEffect, useState } from 'react';`.
  - Add these imports:
```tsx
import type { DocHealthResponse } from '@shared/types';
import { api } from '../../api/client';
import { DOC_STATUS_META } from '../docs/DocStatusChip';
```
  - Insert `<DocsSummary />` right after the closing `</div>` of the `{/* Stat cards */}` grid.
  - Add this component at the end of the file:
```tsx
function DocsSummary() {
  const [summary, setSummary] = useState<DocHealthResponse['summary'] | null>(null);

  useEffect(() => {
    api.getDocHealth().then((r) => setSummary(r.summary)).catch(() => setSummary(null));
  }, []);

  if (!summary) return null;
  return (
    <Link to="/docs" className="block bg-white rounded-xl border border-slate-200 p-5 mb-6 hover:border-indigo-300 transition-colors">
      <h3 className="font-semibold text-slate-700 mb-3">Project docs</h3>
      <div className="flex gap-6 text-sm text-slate-600">
        {(['overdue', 'due_soon', 'missing', 'cant_date'] as const).map((s) => (
          <span key={s}>{DOC_STATUS_META[s].icon} {summary[s]} {DOC_STATUS_META[s].label}</span>
        ))}
      </div>
    </Link>
  );
}
```

- [ ] **Step 3: Verify and commit.**
  - Run: `cd frontend && npx tsc -b && npx vite build` → exit 0.
  - Manual check: the sidebar groups render; Not Pursued toggles; archived still works; the dashboard card links to `/docs`.
```bash
git add frontend/src/components/layout/Sidebar.tsx frontend/src/components/dashboard/Dashboard.tsx
git commit -m "feat(ui): group sidebar by half and team, docs link, dashboard docs card"
```

---

### Task 12: Live dry run against the real roadmap

**Goal:** Load the real 22 items, link the existing projects Brice approves, apply the check to them, and confirm the output matches the known gaps. No project is created and no roadmap link is written without Brice's approval.

**Files:** none (operational; uses the MCP tools from Task 8).

**Acceptance Criteria:**
- [ ] `roadmap_items` holds 22 Digital Products items in Roadmap/Build/Measure.
- [ ] IDEA-850 and IDEA-932 are linked only after Brice confirms each match.
- [ ] `get_doc_health` for the linked projects shows no Brief/PRD link for [OI] Messaging Center (IDEA-850), matching the open item in the spec.
- [ ] The existing lifecycle tasks carry `doc_key` (backfill), and apply creates no duplicate PRD, release-notes or metrics tasks.

**Verify:** `get_doc_health` output reviewed with Brice. The project's TaskManager board shows no duplicate doc tasks.

**Steps:**

- [ ] **Step 1: Restart the TaskManager MCP and backend** so the new tools and migrations load. The user restarts the Claude session or reconnects the `taskmanager` MCP.
- [ ] **Step 2: Fetch the roadmap.** Call roadmap MCP `list_roadmap_items` with `team: "Digital Products", includeSubteams: true, stage: "roadmap,build,measure,on-hold,wont-do"`. Expect ~22–23 items.
- [ ] **Step 3: Sync.** Call `sync_roadmap` with that `items` array. Show Brice the `suggestions` (expected: IDEA-850 ↔ `oi-4`, IDEA-932 ↔ `id-1773091064966-jyqedxkup`) and the `unlinked` list.
- [ ] **Step 4: Link with approval.** For each suggestion Brice approves, call `link_project { project_id, roadmap_item_id }`. Then call `link_project { project_id, waivers: { one_pager: "predates system" } }` for both, since they're in Build or Measure and predate one-pagers.
- [ ] **Step 5: Apply.** Call `apply_doc_check { project_id }` for each linked project. Review the `created` and `redated` lists with Brice, and confirm no duplicates of the backfilled lifecycle tasks.
- [ ] **Step 6: Report.** Call `get_doc_health` and summarize the overdue, missing and can't-date counts for Brice. Projects for the other 20 roadmap items stay as a list for Brice to approve. They're created later, one per approval (`create_project` + `link_project`), and never in bulk without asking.

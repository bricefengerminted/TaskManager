# Task Artifact Linking Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers-extended-cc:subagent-driven-development (if subagents available) or superpowers-extended-cc:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give TaskManager tasks structured `links` (artifact URLs) and a `doc_type` tag, exposed end-to-end (DB → REST → MCP → UI), so the `draft-deliverables` process stops inferring "has this been drafted?" by re-parsing Confluence and stops matching tasks by fragile title strings.

**Architecture:** Purely additive. Two new nullable/defaulted columns on the existing `tasks` table (`links` as a JSON array mirroring the existing `images` column; `doc_type` as a nullable string). Everything else — REST route, shared types, MCP tools, frontend — threads those two fields through. A new `add_task_link` MCP tool does read-modify-write append so Claude can record a link without clobbering existing ones. Finally the Claude-side skills (`draft-deliverables`, `scaffold-project`) are rewired to write `doc_type` at task creation and read `links`/`doc_type` during detection.

**Tech Stack:** Node + Express + TypeScript, Drizzle ORM over libSQL/SQLite (backend); React + TypeScript + Vite + Tailwind (frontend); `@modelcontextprotocol/sdk` + zod (MCP server). Shared types in `shared/types.ts`.

**Testing approach (important):** This repo has **no unit-test framework** (no vitest/jest, no test files) — confirmed by inspection. Introducing one for a single-user personal tool would be a large YAGNI violation and out of proportion to an additive-column change. Following the skill's "follow established patterns in existing codebases" guidance, verification uses the gates that actually exist: `tsc` typecheck/build, plus `curl` round-trips against the running backend (`localhost:3001`) and manual UI checks. Where a step says "Verify," run exactly the command shown.

**Repo / git note:** All tasks except Task 5 modify the **TaskManager** repo (`/Users/brice.fenger/TaskManager`, a git repo) — commit there. Before starting, create a branch: `git -C /Users/brice.fenger/TaskManager checkout -b feat/task-artifact-linking`. Task 5 modifies the **Claude Assistant** directory (`/Users/brice.fenger/Claude Assistant`), which is **not** a git repo — save files, no commit.

**Data shapes (used across all tasks — keep names identical):**
```ts
// shared/types.ts
export interface TaskLink {
  type: string;   // 'confluence' | 'jira' | 'figma' | 'local' | 'other' (free-form; drives icon/label)
  label: string;  // display text, e.g. "Experiment Brief (draft)"
  url: string;    // href (or a local file path for type 'local')
}
// Task gains:      links: TaskLink[];   doc_type: string | null;
// Create/Update gain: links?: TaskLink[];  doc_type?: string | null;
```
`doc_type` known values used by the pipeline: `'experiment_brief' | 'release_notes' | 'metrics_snapshot'` (else `null`). Typed as `string | null` deliberately — new doc types must not require a schema change.

---

### Task 1: Add `links` and `doc_type` columns (schema + migration)

**Goal:** The `tasks` table has a `links` column (JSON array, defaulting `'[]'`) and a nullable `doc_type` column, added idempotently on startup — mirroring exactly how `images`/`position` were added.

**Files:**
- Modify: `backend/src/db/schema.ts`
- Modify: `backend/src/db/migrate.ts`

**Acceptance Criteria:**
- [ ] `tasks` table has `links TEXT NOT NULL DEFAULT '[]'` and `doc_type TEXT` (nullable).
- [ ] Migration is idempotent (guarded by `PRAGMA table_info` like the existing `images`/`position` guards) — safe to run repeatedly.
- [ ] Existing rows get `links = '[]'` and `doc_type = NULL` with no data loss.

**Verify:** `npm run migrate --prefix backend` → prints "Migrations complete." with no error; re-running it is still clean.

**Steps:**

- [ ] **Step 1: Add columns to the Drizzle schema**

In `backend/src/db/schema.ts`, the `tasks` table currently ends:
```ts
  images: text('images').notNull().default('[]'),
  source: text('source', { enum: ['manual', 'slack'] }).notNull().default('manual'),
  slack_raw: text('slack_raw'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});
```
Insert the two new columns immediately after the `images` line:
```ts
  images: text('images').notNull().default('[]'),
  links: text('links').notNull().default('[]'),
  doc_type: text('doc_type'),
  source: text('source', { enum: ['manual', 'slack'] }).notNull().default('manual'),
  slack_raw: text('slack_raw'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});
```

- [ ] **Step 2: Add idempotent migration guards**

In `backend/src/db/migrate.ts`, after the existing `position` guard block:
```ts
  if (!colNames.has('position')) {
    await client.execute(`ALTER TABLE tasks ADD COLUMN position INTEGER NOT NULL DEFAULT 0`);
  }
```
add:
```ts
  if (!colNames.has('links')) {
    await client.execute(`ALTER TABLE tasks ADD COLUMN links TEXT NOT NULL DEFAULT '[]'`);
  }
  if (!colNames.has('doc_type')) {
    await client.execute(`ALTER TABLE tasks ADD COLUMN doc_type TEXT`);
  }
```

- [ ] **Step 3: Run migration and commit**

Run: `npm run migrate --prefix backend`
Expected: console prints `Migrations complete.` with no error. Run it a second time — still clean (proves idempotency).

```bash
git -C /Users/brice.fenger/TaskManager add backend/src/db/schema.ts backend/src/db/migrate.ts
git -C /Users/brice.fenger/TaskManager commit -m "feat(db): add links and doc_type columns to tasks"
```

---

### Task 2: Thread `links` + `doc_type` through shared types and the REST API

**Goal:** Shared types describe the new fields; the tasks REST route parses `links` on read, accepts `links`/`doc_type` on create/update, and supports `?due_within_days=N` and `?doc_type=X` filters on the list endpoint.

**Files:**
- Modify: `shared/types.ts`
- Modify: `backend/src/routes/tasks.ts`

**Acceptance Criteria:**
- [ ] `TaskLink` interface exists; `Task` has `links: TaskLink[]` and `doc_type: string | null`; `CreateTaskInput`/`UpdateTaskInput` have optional `links`/`doc_type`.
- [ ] GET endpoints return `links` as a parsed array (not a JSON string) and `doc_type`.
- [ ] POST accepts `links` (defaults `[]`) and `doc_type` (defaults `null`); PUT updates them only when provided.
- [ ] `GET /api/projects/:projectId/tasks?due_within_days=7` returns only tasks with a non-null `due_date` on or before today+7 (overdue included); `?doc_type=experiment_brief` returns only matching tasks; both combine.

**Verify:** With backend running (`npm run dev --prefix backend`), the curl sequence in Step 4 round-trips a link + doc_type and the filters return the expected subset.

**Steps:**

- [ ] **Step 1: Extend shared types**

In `shared/types.ts`, add the `TaskLink` interface after the `TaskSource` type line:
```ts
export interface TaskLink {
  type: string;
  label: string;
  url: string;
}
```
In the `Task` interface, add after `images: string[];`:
```ts
  links: TaskLink[];
  doc_type: string | null;
```
In `CreateTaskInput`, add:
```ts
  links?: TaskLink[];
  doc_type?: string | null;
```
In `UpdateTaskInput`, add:
```ts
  links?: TaskLink[];
  doc_type?: string | null;
```

- [ ] **Step 2: Parse `links` on every read (rename the row helper)**

In `backend/src/routes/tasks.ts`, replace the `withParsedImages` helper:
```ts
// Parse the images JSON column into an array for API responses
function withParsedImages(row: any) {
  if (!row) return row;
  return { ...row, images: JSON.parse(row.images || '[]') };
}
```
with:
```ts
// Parse JSON columns (images, links) into arrays for API responses
function parseTaskRow(row: any) {
  if (!row) return row;
  return {
    ...row,
    images: JSON.parse(row.images || '[]'),
    links: JSON.parse(row.links || '[]'),
  };
}
```
Then update **every** call site in this file — replace all `withParsedImages(` with `parseTaskRow(`. There are call sites in: GET `/` list (`rows.map(withParsedImages)`), POST `/` (`withParsedImages(task)`), PATCH `/reorder` (`rows.map(withParsedImages)`), GET `/:taskId` (`withParsedImages(task)`), PUT `/:taskId` (`withParsedImages(updated)`), PATCH `/:taskId/status` (`withParsedImages(updated)`).

- [ ] **Step 3: Accept the fields on POST and PUT; add list filters**

POST `/` — extend the destructure and the inserted object. Current:
```ts
  const {
    title,
    description = '',
    status = 'todo',
    priority = 'medium',
    due_date = null,
    source = 'manual',
    slack_raw = null,
  }: CreateTaskInput = req.body;
```
becomes:
```ts
  const {
    title,
    description = '',
    status = 'todo',
    priority = 'medium',
    due_date = null,
    source = 'manual',
    slack_raw = null,
    links = [],
    doc_type = null,
  }: CreateTaskInput = req.body;
```
and in the `task` object being inserted, after `images: '[]',` add:
```ts
    links: JSON.stringify(links ?? []),
    doc_type: doc_type ?? null,
```

PUT `/:taskId` — extend the destructure and the `updated` object. Current destructure:
```ts
  const { title, description, status, priority, due_date, images }: UpdateTaskInput = req.body;
```
becomes:
```ts
  const { title, description, status, priority, due_date, images, links, doc_type }: UpdateTaskInput = req.body;
```
and in the `updated` object, after the `images:` line add:
```ts
    links: links !== undefined ? JSON.stringify(links) : task.links,
    doc_type: doc_type !== undefined ? doc_type : task.doc_type,
```

GET `/` — add query filters. Replace the current list handler body:
```ts
  const rows = await db.select().from(tasks)
    .where(eq(tasks.project_id, req.params.projectId))
    .orderBy(asc(tasks.position))
    .all();
  return res.json(rows.map(withParsedImages));
```
with:
```ts
  let rows = await db.select().from(tasks)
    .where(eq(tasks.project_id, req.params.projectId))
    .orderBy(asc(tasks.position))
    .all();

  // Optional filters (applied in JS — dataset is single-user small)
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
      // due_date is 'YYYY-MM-DD' — lexical <= is correct for ISO dates; includes overdue
      rows = rows.filter((r) => r.due_date != null && r.due_date <= cutoffStr);
    }
  }

  return res.json(rows.map(parseTaskRow));
```

- [ ] **Step 4: Verify round-trip + filters, then commit**

Start the backend: `npm run dev --prefix backend` (leave running in another shell). Then:
```bash
# Create a task with a link + doc_type
curl -s -X POST localhost:3001/api/projects/general/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"LINKTEST","doc_type":"experiment_brief","due_date":"2026-07-10","links":[{"type":"confluence","label":"Draft","url":"https://example.com/x"}]}' | python3 -m json.tool
# Expect: links is an ARRAY (not a string), doc_type == "experiment_brief"

# List filtered by doc_type
curl -s "localhost:3001/api/projects/general/tasks?doc_type=experiment_brief" | python3 -m json.tool
# Expect: includes LINKTEST

# List filtered by due window (LINKTEST due 2026-07-10 is within 7d of 2026-07-09)
curl -s "localhost:3001/api/projects/general/tasks?due_within_days=7" | python3 -m json.tool
# Expect: includes LINKTEST; excludes any task due far in the future

# Cleanup: grab the id from the POST output and delete
# curl -s -X DELETE localhost:3001/api/projects/general/tasks/<id>
```
Also typecheck: `npm run build --prefix backend` → compiles with no errors (emits to `dist/`; harmless).

```bash
git -C /Users/brice.fenger/TaskManager add shared/types.ts backend/src/routes/tasks.ts
git -C /Users/brice.fenger/TaskManager commit -m "feat(api): accept/return task links + doc_type; add list filters"
```

---

### Task 3: Expose links, doc_type, filters, and `add_task_link` through the MCP server

**Goal:** Claude can read `links`/`doc_type` via `list_tasks`, filter by `due_within_days`/`doc_type`, set them via `create_task`/`update_task`, and append a single link without clobbering via a new `add_task_link` tool.

**Files:**
- Modify: `mcp-server/src/index.ts`

**Acceptance Criteria:**
- [ ] `list_tasks` accepts optional `due_within_days` (int) and `doc_type` (string), forwards them as query params, and its summary output includes `links` and `doc_type`.
- [ ] `create_task` and `update_task` accept optional `links` (array of `{type,label,url}`) and `doc_type`.
- [ ] New `add_task_link` tool GETs the task, appends one `{type,label,url}` to its `links`, and PUTs it back (read-modify-write; existing links preserved).
- [ ] `npm run build --prefix mcp-server` compiles clean.

**Verify:** `npm run build --prefix mcp-server` → no TS errors. Functional exercise happens end-to-end in Task 5.

**Steps:**

- [ ] **Step 1: Add filters + output fields to `list_tasks`**

Replace the `list_tasks` tool's parameter object and handler. The params become:
```ts
  {
    project_id: z.string().default("general").describe("Project ID (default: 'general')"),
    status: z
      .enum(["todo", "in_progress", "done"])
      .optional()
      .describe("Filter by status: todo, in_progress, or done"),
    due_within_days: z
      .number()
      .int()
      .optional()
      .describe("Only tasks with a due date on or before today + N days (overdue included)"),
    doc_type: z
      .string()
      .optional()
      .describe("Only tasks with this doc_type (e.g. experiment_brief, release_notes, metrics_snapshot)"),
  },
```
and the handler:
```ts
  async ({ project_id, status, due_within_days, doc_type }) => {
    try {
      const qs = new URLSearchParams();
      if (due_within_days !== undefined) qs.set("due_within_days", String(due_within_days));
      if (doc_type !== undefined) qs.set("doc_type", doc_type);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      const tasks = await api(`/projects/${project_id}/tasks${suffix}`);
      const filtered = status ? tasks.filter((t: any) => t.status === status) : tasks;

      if (filtered.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No tasks found${status ? ` with status '${status}'` : ""}.` }],
        };
      }

      const summary = filtered.map((t: any) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        due_date: t.due_date,
        doc_type: t.doc_type ?? undefined,
        links: (t.links && t.links.length) ? t.links : undefined,
        description: t.description || undefined,
      }));

      return {
        content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
      };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }
```

- [ ] **Step 2: Accept `links` + `doc_type` on `create_task` and `update_task`**

Define a reusable zod shape just above the `create_task` registration:
```ts
const linkSchema = z.object({
  type: z.string().describe("confluence | jira | figma | local | other"),
  label: z.string(),
  url: z.string(),
});
```
In `create_task` params, add:
```ts
    links: z.array(linkSchema).optional().describe("Artifact links to attach on creation"),
    doc_type: z.string().optional().describe("Lifecycle doc type, e.g. experiment_brief / release_notes / metrics_snapshot"),
```
and in its handler, extend the destructure to include `links, doc_type` and add them to the POST body:
```ts
        body: JSON.stringify({
          title,
          description: description || "",
          priority,
          due_date: due_date || null,
          status,
          links: links || [],
          doc_type: doc_type ?? null,
        }),
```
In `update_task` params, add the same two lines (`links`, `doc_type`). In its handler, after the existing `if (due_date !== undefined) ...` line, add:
```ts
      if (links !== undefined) body.links = links;
      if (doc_type !== undefined) body.doc_type = doc_type;
```
(and include `links, doc_type` in the handler's destructured argument list).

- [ ] **Step 3: Add the `add_task_link` tool**

Register a new tool after `update_task`:
```ts
server.tool(
  "add_task_link",
  "Append one artifact link (Confluence draft, Jira, Figma, local file path, etc.) to a task WITHOUT overwriting its existing links. Use to record a drafted deliverable back onto its task.",
  {
    task_id: z.string().describe("Task ID"),
    project_id: z.string().default("general").describe("Project ID (default: 'general')"),
    type: z.string().describe("Link type: confluence | jira | figma | local | other"),
    label: z.string().describe("Display label, e.g. 'Experiment Brief (draft)'"),
    url: z.string().describe("The URL (or local file path for type 'local')"),
  },
  async ({ task_id, project_id, type, label, url }) => {
    try {
      const task = await api(`/projects/${project_id}/tasks/${task_id}`);
      const links = Array.isArray(task.links) ? task.links : [];
      links.push({ type, label, url });
      const updated = await api(`/projects/${project_id}/tasks/${task_id}`, {
        method: "PUT",
        body: JSON.stringify({ links }),
      });
      return {
        content: [{ type: "text" as const, text: `Added link to "${updated.title}": ${label} → ${url} (now ${updated.links.length} link(s))` }],
      };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }
);
```

- [ ] **Step 4: Build and commit**

Run: `npm run build --prefix mcp-server`
Expected: compiles, no TS errors, `dist/index.js` updated locally (used at runtime).

> **Git note:** `dist/` is gitignored — do NOT try to commit `mcp-server/dist/`. Also, `mcp-server/` has never been committed (it's untracked, not ignored), so this commit adds its **source** to git for the first time. Stage the source directory, not build output:
```bash
git -C /Users/brice.fenger/TaskManager add mcp-server/src mcp-server/package.json mcp-server/tsconfig.json
git -C /Users/brice.fenger/TaskManager commit -m "feat(mcp): expose links/doc_type, list filters, add_task_link tool"
```
(If `mcp-server/package.json` / `tsconfig.json` are already tracked, staging them again is a no-op — harmless.)

> **Note for executor:** the MCP server is a long-running process registered with Claude Code. After building, it must be restarted to pick up the new tools (the user does this via their MCP client / restarting the session). Flag this in the handoff — the new `add_task_link` tool and params won't be callable until the MCP server reloads.

---

### Task 4: Surface links + doc_type in the frontend

**Goal:** The task form lets you see/add/remove links and shows a `doc_type` badge; the task table renders link chips and the badge. Mirrors the existing Photos UX pattern.

**Files:**
- Modify: `frontend/src/components/tasks/TaskForm.tsx`
- Modify: `frontend/src/components/tasks/TaskList.tsx`

**Acceptance Criteria:**
- [ ] TaskForm shows a "Links" section: existing links listed as removable rows; an input to add a link by URL (with optional label); links are included in the create/update payload.
- [ ] TaskForm shows the `doc_type` as a read-only badge when present (it's set by automation, not hand-edited).
- [ ] TaskList renders each task's links as clickable chips and shows a `doc_type` badge.
- [ ] `cd frontend && npx tsc --noEmit` passes.

**Verify:** `cd /Users/brice.fenger/TaskManager/frontend && npx tsc --noEmit` → no errors. Manual: start the app, open a task, add a link, save, reopen — link persists and is clickable.

**Steps:**

- [ ] **Step 1: TaskForm — links state, editor, doc_type badge, payload**

In `frontend/src/components/tasks/TaskForm.tsx`:

Import the type — change the type import line to include `TaskLink`:
```ts
import type { Task, TaskStatus, TaskPriority, TaskLink } from '@shared/types';
```
Add state alongside the other `useState` hooks (near `const [images, setImages] = ...`):
```ts
  const [links, setLinks] = useState<TaskLink[]>(task?.links ?? []);
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [newLinkLabel, setNewLinkLabel] = useState('');
```
Add helpers just above `handleSubmit`:
```ts
  const addLink = () => {
    const url = newLinkUrl.trim();
    if (!url) return;
    let label = newLinkLabel.trim();
    if (!label) {
      try { label = new URL(url).hostname.replace(/^www\./, ''); } catch { label = url; }
    }
    setLinks((prev) => [...prev, { type: 'other', label, url }]);
    setNewLinkUrl('');
    setNewLinkLabel('');
  };
  const removeLink = (index: number) => setLinks((prev) => prev.filter((_, i) => i !== index));
```
Include `links` in BOTH submit paths. In `handleSubmitWithImages` (the one actually wired to the form's `onSubmit`), update the create and update calls to pass `links`:
```ts
      if (isEdit && task) {
        await updateTask(task.project_id, task.id, { title, description, status, priority, due_date: dueDate || null, images, links });
      } else {
        const created = await createTask(targetProjectId, { title, description, status, priority, due_date: dueDate || null, links });
        if (images.length > 0) {
          await updateTask(targetProjectId, created.id, { images });
        }
      }
```
(Apply the same `links` addition to the parallel calls in `handleSubmit` so the two paths stay consistent.)

Add the Links UI section — insert this block right after the closing `</div>` of the "Photos" section (just before the final actions `<div className="flex items-center justify-between pt-2">`):
```tsx
          {/* Links */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Links</label>
            {task?.doc_type && (
              <span className="inline-block mb-2 text-xs font-medium px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                {task.doc_type}
              </span>
            )}
            {links.length > 0 && (
              <ul className="space-y-1 mb-2">
                {links.map((lnk, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <a href={lnk.url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:text-indigo-800 truncate" title={lnk.url}>
                      {lnk.label}
                    </a>
                    <span className="text-slate-400 text-xs">{lnk.type}</span>
                    <button type="button" onClick={() => removeLink(i)} className="ml-auto text-red-400 hover:text-red-600 text-xs">Remove</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <input
                type="url"
                value={newLinkUrl}
                onChange={(e) => setNewLinkUrl(e.target.value)}
                placeholder="https://..."
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                type="text"
                value={newLinkLabel}
                onChange={(e) => setNewLinkLabel(e.target.value)}
                placeholder="Label (optional)"
                className="w-40 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button type="button" onClick={addLink} className="px-3 py-2 rounded-lg text-sm font-medium bg-slate-100 hover:bg-slate-200 text-slate-700">Add</button>
            </div>
          </div>
```

- [ ] **Step 2: TaskList — link chips + doc_type badge**

In `frontend/src/components/tasks/TaskList.tsx`, in the row that renders the task's "Task" cell (title/description area), add — after the title element — a chips/badge block:
```tsx
                {task.doc_type && (
                  <span className="ml-2 align-middle text-[10px] font-medium px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                    {task.doc_type}
                  </span>
                )}
                {task.links && task.links.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {task.links.map((lnk, i) => (
                      <a
                        key={i}
                        href={lnk.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600"
                        title={lnk.url}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5M10.172 13.828a4 4 0 010-5.656l3-3a4 4 0 015.656 5.656l-1.5 1.5" />
                        </svg>
                        {lnk.label}
                      </a>
                    ))}
                  </div>
                )}
```
Place this inside the existing `<td>` that shows the task title, immediately after the title/description markup and before that cell closes. (If the exact title cell markup differs, attach these two blocks adjacent to where `task.title` is rendered.)

- [ ] **Step 3: Typecheck, manual check, commit**

Run: `cd /Users/brice.fenger/TaskManager/frontend && npx tsc --noEmit`
Expected: no errors.

Manual: start the full app (`bash /Users/brice.fenger/TaskManager/start.sh` or `npm run dev:frontend` + `npm run dev:backend`), open a task, add a link, Save, reopen → the link persists and opens in a new tab; a task with a `doc_type` shows its badge.

```bash
git -C /Users/brice.fenger/TaskManager add frontend/src/components/tasks/TaskForm.tsx frontend/src/components/tasks/TaskList.tsx
git -C /Users/brice.fenger/TaskManager commit -m "feat(ui): task links editor + chips and doc_type badge"
```

---

### Task 5: Rewire the Claude-side skills to use `doc_type` + `links`

**Goal:** `scaffold-project` stamps `doc_type` on the lifecycle tasks it creates (producer side); `draft-deliverables` identifies tasks by `doc_type`, gates readiness via `due_within_days`, and records drafted artifacts back onto the task via `add_task_link` and uses the task's `links` as the primary "already drafted?" signal (consumer side).

**Files (Claude Assistant dir — NOT a git repo; save only, no commit):**
- Modify: `/Users/brice.fenger/Claude Assistant/.claude/skills/scaffold-project/SKILL.md`
- Modify: `/Users/brice.fenger/Claude Assistant/.claude/skills/draft-deliverables/SKILL.md`

**Acceptance Criteria:**
- [ ] `scaffold-project` instructs setting `doc_type` when creating the experiment-brief, release-notes, and metrics-snapshot lifecycle tasks (values `experiment_brief` / `release_notes` / `metrics_snapshot`).
- [ ] `draft-deliverables` Detection identifies the target task by `doc_type` (with title-string match kept only as a legacy fallback), and uses `list_tasks(due_within_days: 7)` for the due gate instead of manual per-task date reasoning.
- [ ] `draft-deliverables` "already drafted?" check reads the task's `links` (a link whose `type` matches the doc, e.g. `confluence`) as the primary signal; the Confluence Key Links table becomes the secondary/mirror.
- [ ] `draft-deliverables` Filing calls `add_task_link` for the Confluence draft (type `confluence`) and the local copy (type `local`) after creating them.

**Verify:** Dry-run trace (consistent with this repo's markdown-skill convention — no automated test). Re-read both skill files and confirm each acceptance criterion maps to explicit instruction text; then mentally run Detection against IDEA-932 (its "Create experimentation doc" task now carries `doc_type: experiment_brief` and a `confluence` link from the 2026-07-09 dry run → correctly skipped as already-drafted).

**Steps:**

- [ ] **Step 1: scaffold-project — stamp doc_type on lifecycle tasks**

In `.claude/skills/scaffold-project/SKILL.md`, under **Step 4: Create in TaskManager**, after the existing bullet about task title prefixes, add:
```markdown
   - When creating these specific lifecycle tasks, ALSO set the `doc_type` field so
     downstream automation (draft-deliverables) can identify them structurally rather
     than by title string:
     - "Create experimentation doc" → `doc_type: "experiment_brief"`
     - "Write release notes" → `doc_type: "release_notes"`
     - "2-week metrics check" AND "Final results readout" → `doc_type: "metrics_snapshot"`
     - All other lifecycle tasks → leave `doc_type` unset (null).
```

- [ ] **Step 2: draft-deliverables — Detection uses doc_type + due gate + links**

In `.claude/skills/draft-deliverables/SKILL.md`, replace Detection sub-steps 1, 1b, and 2 with the versions below.

Replace step 1:
```markdown
1. Identify the candidate task by its `doc_type` field: `experiment_brief` (Plan),
   `release_notes` (Measure), `metrics_snapshot` (Measure). Prefer `doc_type`; fall
   back to the old exact-title match ("Create experimentation doc", "Write release
   notes", "2-week metrics check", "Final results readout") ONLY for legacy tasks
   created before doc_type existed. If the task is `done` or absent, skip.
```
Replace step 1b (the due gate):
```markdown
1b. **Due-date gate via query:** call `list_tasks` with `due_within_days: 7` for the
   project and confirm the candidate task is in that result set (this returns overdue
   tasks too). If it isn't (due date is farther out), skip — status alone is not a
   readiness signal. Tasks with no due date are treated as NOT ready.
```
Replace step 2 (the "already drafted?" check):
```markdown
2. Determine whether the deliverable already exists, PRIMARY signal first:
   - The task's `links` array already contains a link for this doc (e.g. a `confluence`
     link for a brief/snapshot) → already drafted. Skip.
   - Secondary/mirror: the canonical Confluence page's Key Links row for that doc type
     is populated with a real link → already drafted. Skip.
   - Neither present → draft it. (A missing Key Links row still means "not created," per
     the original note about IDEA-845/852/932.)
```

- [ ] **Step 3: draft-deliverables — Filing records links back onto the task**

In the same file, in the Filing step, after the sub-step that creates the local copy and before/with the Key Links update, add:
```markdown
4. Record the artifacts back onto the TaskManager task via `add_task_link` (so future
   Detection is a field check, not an HTML parse):
   - `add_task_link(task_id, project_id, type: "confluence", label: "<doc type> (draft)", url: <Confluence draft URL>)`
   - `add_task_link(task_id, project_id, type: "local", label: "local copy", url: <local file path>)`
   Then still update the canonical page's Key Links row (secondary mirror) as before.
```
Renumber the subsequent Filing/Reporting sub-steps if needed so the sequence stays linear.

- [ ] **Step 4: Verify by trace (no commit — not a git repo)**

Re-read both edited skill files start-to-finish. Confirm each Task 5 acceptance criterion has explicit supporting text. Trace Detection once against IDEA-932's "Create experimentation doc" task and confirm the outcome is "skip — already drafted" (it now carries a `confluence` link + `doc_type: experiment_brief` from today's dry run). No git commit — `/Users/brice.fenger/Claude Assistant` is not a git repository.

---

## Self-Review

- **Spec coverage:** The three ideas raised in conversation are all covered — linked-artifact field (Tasks 1–4), `due_within_days` filter (Tasks 2–3, used in 5), and `doc_type` tag replacing title-string matching (Tasks 1–5). "As linked as possible" is honored: links are writable/readable at DB, REST, MCP, and UI layers, plus a dedicated append tool and producer/consumer skill wiring.
- **Type consistency:** `TaskLink {type,label,url}` is defined once (Task 2) and used identically in the route, MCP `linkSchema`, frontend, and `add_task_link`. `doc_type` is `string | null` everywhere. The route helper is renamed `parseTaskRow` and all six call sites are updated in the same task.
- **No placeholders:** every code step shows the actual code; verify steps are real commands (`npm run migrate`, `curl`, `npm run build`, `npx tsc --noEmit`).
- **Ordering/deps:** 1 → 2 → {3, 4}; 3 → 5. Frontend (4) needs shared types (2) but not the MCP (3). Skill rewiring (5) needs the MCP tools (3).

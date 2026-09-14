# Planner + Command-Center Home + Activity Log — Design

**Date:** 2026-07-20
**Status:** SUPERSEDED by `2026-09-14-taskmanager-control-plane-design.md`.
The activity log and the actionable cockpit dashboard carry forward into that design;
the manual day-planner (`planned_date` / Week drag board) was intentionally dropped
because the real daily unit is roadmap-lifecycle due dates, not manual day-scheduling.

## Problem

TaskManager is now closely tied to the user's daily update loop with Claude (Claude writes
updates to the board via MCP) and functions as a source of truth. Three gaps:

1. **No time-based planning.** `due_date` is the only time signal. There is no concept of
   "what I chose to work on today/this week," and no daily or weekly view.
2. **No cross-project view.** Every task lives inside one project's kanban board. There is no
   way to see, prioritize, or reorder work across projects.
3. **Claude's writes are invisible.** Claude creates/updates/completes tasks via MCP, but the
   app shows no history, so the user cannot trust or audit what changed.

## Decisions (from brainstorming)

- **Daily/weekly basis: hybrid.** Deadlines auto-surface (due/overdue always shown) AND the
  user can pull any task onto a specific day as a plan. Requires a `planned_date` separate
  from `due_date`.
- **Scope: command-center home (B).** Planner + activity log + a redesigned "Today" landing
  page combining today's plan, needs-attention, and recent activity.
- **Today is the default landing page.** Dashboard moves to its own nav item.
- **Extras included:** quick-add, cross-project overdue/priority surfacing, explicit
  carry-over of unfinished planned tasks.
- **Extras deferred:** recurring tasks (heaviest data-model change; Claude can recreate
  standing items in the meantime).
- **Carry-over is explicit, never silent.** Unfinished tasks planned before today surface in a
  "Carried over" section with one-click pull-forward; no mutation happens on a GET.

## Architecture

Existing stack (unchanged): Express + Drizzle + SQLite backend (single-user), React 19 +
React Router 7 + Tailwind 3 frontend, `@hello-pangea/dnd` for drag-and-drop, separate MCP
server exposing tools to Claude. No new dependencies — the Week view (drag between day
columns) and Today view (reorder within a day) reuse the same dnd mechanics as the current
board.

### 1. Data model

**`tasks` — two new columns:**

| Column | Type | Notes |
|---|---|---|
| `planned_date` | `TEXT` nullable, `'YYYY-MM-DD'` | The day the user plans to work the task, independent of `due_date`. |
| `planned_position` | `INTEGER NOT NULL DEFAULT 0` | Order within a planned day (drag to prioritize). Existing `position` stays for the project board. |

**New `activity` table (append-only log):**

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT` PK | uuid |
| `created_at` | `TEXT` | ISO timestamp |
| `actor` | `TEXT` | `'claude' \| 'user'` — makes Claude's writes visible |
| `type` | `TEXT` | `task_created \| status_changed \| task_completed \| task_updated \| link_added \| task_planned \| task_deleted \| project_created` |
| `task_id` | `TEXT` nullable | Plain text (no FK) so log survives deletion |
| `project_id` | `TEXT` nullable | Plain text |
| `task_title` | `TEXT` nullable | Snapshot of title at event time (survives deletion) |
| `summary` | `TEXT` | Human sentence, e.g. "Marked done", "Planned for Jul 21", "Added Confluence link" |
| `detail` | `TEXT` nullable | JSON before/after for updates |

**Actor detection:** the MCP server's `api()` helper sends header `X-TM-Actor: claude` on every
request. Backend reads it and defaults to `'user'` when absent. UI requests omit the header.

### 2. Backend API

New file `backend/src/routes/planner.ts` and `backend/src/routes/activity.ts`; extend
`backend/src/routes/tasks.ts`.

- **`logActivity(...)` helper** — called inside task mutation routes (create / PUT / status /
  delete). Logging failures are swallowed (logged to stderr) and never block the primary write.
- **PUT diff logic** — the PUT route compares old vs new to emit precise events: `link_added`
  when the links array grows, `task_planned` when `planned_date` changes, `status_changed` /
  `task_completed` on status change, `task_updated` otherwise.
- **`GET /api/activity?limit=50`** — recent activity across everything, newest first.
- **`GET /api/planner?date=YYYY-MM-DD`** — cross-project. Returns `{ planned: Task[], due: Task[] }`
  where `planned` = tasks with that `planned_date` (ordered by `planned_position`) and `due` =
  incomplete tasks due on/before that date not already planned for it (overdue included). Each
  task enriched with `project_name`.
- **`GET /api/planner/week?start=YYYY-MM-DD`** — `{ days: { 'YYYY-MM-DD': Task[] }, unplanned: Task[] }`
  for a 7-day window; `unplanned` = incomplete tasks due within the window with no `planned_date`.
- **`PATCH /api/planner/reorder`** — body `{ days: { 'YYYY-MM-DD': [taskId, ...] } }`; sets
  `planned_date` + `planned_position` for each listed task (mirrors existing `/reorder`).
- **`POST /api/planner/rollover`** — moves incomplete tasks with `planned_date < today` onto
  today (appended after today's existing planned tasks). Button-triggered only.
- **`tasks` create + PUT** accept `planned_date`.

All new response tasks reuse `parseTaskRow` (JSON-parse `images`/`links`).

### 3. MCP server (`mcp-server/src/index.ts`)

- `api()` helper adds `X-TM-Actor: claude` header.
- `create_task` / `update_task` gain a `planned_date` param (YYYY-MM-DD, or empty to clear).
- New **`plan_task`** tool — set or clear a task's `planned_date`.
- New **`get_planner`** tool — read today's or a given day's/week's plan (calls the planner
  endpoints), so Claude can arrange and narrate the user's day.
- Activity logging is automatic server-side; no MCP change needed for the log itself.

### 4. Frontend

**Routing / nav:**
- `/` → **Today** (new home), `/week` → **Week**, `/dashboard` → existing Dashboard (moved from `/`).
- Projects routes unchanged. Sidebar gains Today / Week / Dashboard nav items at the top.

**Today page (command center) — `components/planner/Today.tsx`:**
- Date header + **quick-add** box: title, project select (default `general`), "plan for today" toggle.
- **Needs-attention strip** — overdue + urgent tasks across all projects, always visible.
- **Today's plan** — tasks planned today; drag to reorder (`planned_position`), checkbox to
  complete; each shows project chip, priority, due date.
- **Carried over** — incomplete tasks planned before today; one-click "pull to today" per task
  + a "roll all forward" button (calls `/planner/rollover`).
- **Recent activity** feed — last N events with an actor badge (Claude vs user).

**Week page — `components/planner/Week.tsx`:**
- 7 day-columns (Mon–Sun of current week, navigable prev/next). Drag between days sets
  `planned_date`; reorder within a day sets `planned_position`.
- Side rail: "due this week but unplanned" to drag from.

**Quick-add — `components/planner/QuickAdd.tsx`** (reusable, also usable in top bar later).

Shared: a compact `PlannerTaskCard` for the planner surfaces (distinct from the board card).

### 5. Error handling & testing

- Routes validate inputs, return `4xx` with `{ error }`; frontend surfaces failures via existing
  context error state.
- Activity logging never blocks or fails the primary write (swallow + stderr).
- **Tests:** backend route tests for planner + activity endpoints and the PUT-diff activity
  logic (the trickiest part). Confirm existing test infra during planning; add minimal setup if
  none exists.

## Build order (phased, reviewable)

1. Migration: `planned_date`, `planned_position`, `activity` table.
2. Activity logging helper + PUT-diff + `GET /api/activity`.
3. Planner endpoints (read, week, reorder, rollover) + `planned_date` on create/PUT.
4. MCP: `planned_date` param, `plan_task`, `get_planner`, `X-TM-Actor` header.
5. Frontend: nav restructure + Today page (quick-add, needs-attention, today's plan, carry-over, activity feed).
6. Frontend: Week page.

## Out of scope

- Recurring tasks.
- Multi-user / auth.
- Notifications/push.
- Free-text daily notes (activity log + tasks cover the need).

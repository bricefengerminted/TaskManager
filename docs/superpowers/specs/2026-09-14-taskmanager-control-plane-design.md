# TaskManager as Control Plane — Inbox, Cockpit, Roadmap Reconciliation, Outbox

**Date:** 2026-09-14
**Status:** Approved (design), pending implementation plan
**Supersedes:** `2026-07-20-planner-command-center-design.md`

## Problem

TaskManager and the daily-briefing routine are two halves of one machine built separately.

- The **roadmap** is the Jira Product Discovery "IDEA" board (Discover → Roadmap → Plan →
  Build → Measure → Done), monitored by labels (WW/OI/ABK/…), with Build Start
  (`customfield_11257`) and Release (`customfield_11216`) dates.
- **TaskManager projects map 1:1 to active IDEA tickets**; each carries ~23–26 lifecycle
  tasks whose due dates are computed from Build Start / Release.
- **`~/Claude Assistant/state/project-timelines.md`** is a hand-maintained markdown bridge
  reconciling IDEA ↔ TaskManager project ↔ Confluence canonical page ↔ dates ↔ status.
- The **daily-briefing routine** (`~/.claude/scheduled-tasks/daily-morning-briefing/SKILL.md`)
  already reads GCal/Jira/Slack/Drive and *autonomously* creates tasks from meeting notes and
  recalcs due dates from Jira shifts, then writes a **static markdown briefing** to
  `~/Claude Assistant/artifacts/daily/YYYY-MM-DD-start.md`.

Three pain points, one root cause — **the machine writes without asking, and its output isn't
a surface you can work in**:

1. Routine auto-files tasks and date changes with no approval; some are noise, some need date/
   scope edits, some should be declined.
2. The dashboard doesn't help; the briefing is a dead markdown file. There's no single place to
   see and act on what's coming due without diving into individual project boards.
3. TaskManager is disconnected from the roadmap: IDEA items exist with no project (IDEA-949,
   IDEA-547, IDEA-102), release dates lapse, canonical pages sit in DRAFT — and none of it is
   visible in the app.

## Decisions (from brainstorming)

- **Control-plane architecture.** TaskManager is an **Inbox** (things coming in from the world
  → user triages) and an **Outbox** (approved changes → pushed back out). Claude — the routine,
  or the user on-demand — is the **actuator** that drains both queues via MCP. **The Express
  backend holds no external credentials and never calls Jira/Confluence/JPD directly.** This
  reuses the routine's working connectors, keeps the Atlassian concurrency-bug workaround in one
  place, and sidesteps backend OAuth entirely.
- **Everything the routine generates is a proposal.** New tasks from meetings/Slack, Jira-driven
  due-date shifts, AND "scaffold a project for this orphan IDEA ticket" all land as pending
  proposals. Nothing the routine produces commits without the user.
- **Spec all three phases now**, build/review phase by phase.
- **Carry forward** from the superseded spec: the activity log (actor = claude|user) and the
  actionable cockpit dashboard. **Drop** the manual day-planner (`planned_date`/Week drag).
- The user's own manual actions (creating a task in the UI, editing a date) still commit
  immediately — the approval gate is only for machine-generated writes.

## Architecture overview

```
  World (Jira/JPD, Confluence, Slack, GCal, Drive)
        │  read (routine, via MCP)                ▲  write-back (routine drains Outbox, via MCP)
        ▼                                         │
  ┌─────────────────────────────────────────────────────────┐
  │  TaskManager backend (Express + SQLite)  — NO ext. creds  │
  │   Inbox: proposals   Tasks/Projects   Roadmap mirror      │
  │   Activity log       Briefings        Outbox              │
  └─────────────────────────────────────────────────────────┘
        ▲ approve/edit/decline, work tasks              │ render
        │                                               ▼
                      Web UI (React)  — Cockpit · Inbox · Roadmap · Projects
```

Claude is the only thing that talks to external systems, in both directions. The app stores
*intents and state*; it never reaches out.

---

## Phase 1 — Inbox + live cockpit + activity log

Self-contained. No external write-back. The routine switches from committing to proposing, and
the dashboard becomes where the user works.

### Data model

**New `proposals` table** (the Inbox — a queue of intended mutations):

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | uuid |
| `created_at` / `updated_at` | TEXT | |
| `kind` | TEXT | `create_task \| update_task \| create_project` (create_project carries a computed lifecycle task list in payload) |
| `status` | TEXT | `pending \| approved \| declined \| applied \| superseded` |
| `source` | TEXT | `meeting_notes \| slack \| jira_timeline \| roadmap_gap \| manual` |
| `actor` | TEXT | proposer, normally `claude` |
| `dedupe_key` | TEXT | e.g. `meeting:<docId>:<itemHash>`, `dateshift:<idea>:<field>:<value>`, `scaffold:<idea>`. Re-proposing an existing pending key updates in place; a declined key is skipped. |
| `title` | TEXT | short "what this proposes" |
| `rationale` | TEXT | why, with provenance ("action item from 'WW Touchbase' 2026-09-12") |
| `target_project_id` | TEXT nullable | for task proposals |
| `target_task_id` | TEXT nullable | for change proposals |
| `payload` | TEXT (JSON) | the exact fields to write when approved (task fields; or the date changes; or project + its lifecycle tasks). The user may edit this before approving. |
| `confidence` | TEXT nullable | `low\|medium\|high`, optional |
| `result_task_id` / `result_project_id` | TEXT nullable | set on apply |
| `decided_at` | TEXT nullable | |

**New `activity` table** (append-only; carried from superseded spec, types expanded):

`id`, `created_at`, `actor` (`claude\|user`), `type`
(`task_created \| status_changed \| task_completed \| task_updated \| link_added \|
task_deleted \| project_created \| proposal_created \| proposal_approved \|
proposal_declined \| proposal_applied` — Phase 3 adds `pushed_*`), `task_id`, `project_id`,
`task_title` (snapshot), `summary`, `detail` (JSON, optional).

**New `briefings` table**: `date` (PK, `YYYY-MM-DD`), `sections` (JSON: must_do / should_do /
if_time / stakeholder_updates / data_gaps / catch_up), `created_at`. The markdown artifact
stays as a byproduct archive; the app renders from this row.

**Actor detection:** the MCP `api()` helper sends `X-TM-Actor: claude`; backend defaults to
`user` when absent.

### Backend API

- **`logActivity()` helper** in task/proposal mutation routes; failures swallowed (stderr),
  never block the primary write. PUT diffs old→new to emit precise events.
- **`proposals.ts`**: `GET /api/proposals?status=pending`; `POST /api/proposals` (create, with
  dedupe); `PATCH /api/proposals/:id` (edit payload); `POST /api/proposals/:id/approve` (apply
  payload → create task / create project + lifecycle tasks / apply change; mark `applied`; log);
  `POST /api/proposals/:id/decline` (mark `declined`; log; remembered for dedupe). Bulk variants
  accept an array of ids.
- **`GET /api/activity?limit=50`** — newest first, across everything.
- **`briefing.ts`**: `POST /api/briefing` (routine posts structured sections for a date);
  `GET /api/briefing?date=today` (cockpit renders).
- **`GET /api/tasks/upcoming?days=N`** — cross-project incomplete tasks due within N days plus
  overdue, enriched with `project_name` (and `idea_key` once Phase 2 lands), newest-due first.
  Powers the cockpit's actionable list.
- Existing task create/PUT/status/delete gain activity logging. Approve of a `create_project`
  proposal writes the project and the lifecycle tasks exactly as the (possibly edited) payload
  specifies — **the backend applies, it does not compute** (lifecycle date math stays in the
  routine, so its rules live in one place and remain user-editable pre-approval).

### MCP server

- `api()` adds `X-TM-Actor: claude`.
- New: **`propose_task`**, **`propose_change`**, **`propose_project`** (create proposals with
  `dedupe_key`, `rationale`, `source`, `confidence`). **`list_proposals`** (so the routine can
  see pending/declined and avoid re-proposing). **`post_briefing`** (structured sections).
- Existing `create_task`/`update_task`/`complete_task` stay — used for genuine on-demand
  immediate writes the user asks Claude for; the **routine** switches its Step-3 writes to
  `propose_*`.

### Frontend

- **Nav:** Today (cockpit, default `/`) · Inbox (badge = pending count) · Roadmap (Phase 2) ·
  Dashboard (existing, moved) · Projects (unchanged).
- **Cockpit (`/`)** — rendered briefing (Must do / Should do / If time / stakeholder updates /
  data gaps / catch-up) + **upcoming & nearly-due** list actionable inline (complete,
  reschedule, change status, open links, jump to Inbox) + recent activity feed with actor
  badges. No project navigation required to act.
- **Inbox (`/inbox`)** — proposal cards grouped by source. Each: Approve · Edit · Decline. Edit
  opens the payload (title, project, due date, priority, links; for scaffolds, the proposed
  task list) for changes before approving. Bulk approve/decline. Declines disappear and are not
  re-proposed.
- No new dependencies; reuse `@hello-pangea/dnd` only where already used.

### Routine changes (coordinated, outside the app repo)

`daily-morning-briefing/SKILL.md` Step 3 stops calling `create_task`/`update_task` directly and
instead calls `propose_*` with dedupe keys and rationale; it calls `post_briefing` with the
structured sections in addition to writing the markdown archive. `X-TM-Actor: claude` header
added in the MCP client. Monday/Friday routines get the same treatment where they write.

---

## Phase 2 — Roadmap as data + reconciliation view

Retire `project-timelines.md` as the source of truth; make the IDEA↔TaskManager gaps visible
and fixable in the app.

### Data model

**New `roadmap_items` table** (mirror of the monitored IDEA board, written by the routine):

`idea_key` (PK, e.g. `IDEA-850`), `name`, `status`, `labels` (JSON), `build_start_date`,
`release_date`, `assignee`, `project_id` (nullable link to a TaskManager project),
`canonical_page_id`, `canonical_page_url`, `canonical_page_status` (`draft|current`),
`canonical_page_updated_at`, `flags` (JSON, e.g. `["no_project","lapsed_release","page_stale"]`),
`notes`, `synced_at`.

`projects` gains a nullable `idea_key` for quick display; `roadmap_items.project_id` is the
authoritative join.

### Backend API — `roadmap.ts`

- `POST /api/roadmap/items` — upsert (routine writes the snapshot).
- `GET /api/roadmap` — items grouped by status, each with linked project + lifecycle progress.
- `GET /api/roadmap/reconcile` — computed gaps: IDEA items in Build/Measure with no project
  (→ offer a `scaffold` action that creates a `create_project` proposal); projects with no
  `idea_key` ("in TaskManager, not on roadmap"); project due dates that disagree with the
  item's Build Start / Release; canonical pages stale (`current` >14d) or stuck in `draft`.

### MCP server

- `upsert_roadmap_item` / `sync_roadmap` (routine writes the mirror instead of editing the
  markdown file). `list_roadmap` / `get_reconciliation` for reads.

### Frontend — `/roadmap`

Reconciliation view: IDEA items by status, linked project + lifecycle checklist progress, date
match/mismatch, canonical-page freshness, gap flags; a per-item **Scaffold** action (creates a
proposal, not an immediate write); a "not on roadmap" section for orphan projects.

### Migration

One-time import seeds `roadmap_items` and project `idea_key`s from `project-timelines.md`.
Thereafter the routine keeps the mirror current; the markdown is retired (optionally kept as a
human-readable export).

---

## Phase 3 — Outbox write-back

Approving certain changes queues an external write the routine performs. **The backend only
stores intents; Claude executes them.**

### Data model — `outbox` table

`id`, `created_at`, `kind` (`jira_update_dates \| confluence_refresh_page \| jira_transition \|
jpd_note \| …`), `status` (`pending \| in_progress \| done \| failed \| skipped`),
`target` (JSON, e.g. `{idea_key, fields}` or `{page_id}`), `payload` (JSON),
`origin_proposal_id` / `origin_task_id` (nullable), `attempts` (INT), `last_error` (TEXT),
`pushed_at`.

### Backend API — `outbox.ts`

- `POST /api/outbox` — enqueue (normally created as a side effect of approving a proposal).
- `GET /api/outbox?status=pending` — routine drains this.
- `PATCH /api/outbox/:id` — routine reports result (`done`/`failed` + `last_error`).

### MCP server

- `list_outbox` + `complete_outbox_item`. The routine gains a drain step: read pending items,
  perform each external write via MCP (Atlassian calls strictly one-at-a-time per the known
  concurrency bug), PATCH the result back.

### Frontend

Small **Outbox status** panel (on the cockpit or its own route): pending / failed counts, with
a retry (re-enqueue) affordance for failed items. Start with the lowest-risk `kind`:
`jira_update_dates` (date propagation, already computed by the routine) and
`confluence_refresh_page`.

---

## Error handling & testing (all phases)

- Proposal approve applies transactionally; activity logged; logging never blocks a write.
- Outbox: backend stores only; the routine reports failures via PATCH; the UI surfaces failed
  items for retry. No external call ever originates in the Express backend.
- Inputs validated; `4xx` with `{error}`; frontend surfaces failures via existing context error
  state.
- **Tests:** backend route tests for proposal approve/decline/edit/dedupe and `create_project`
  application; roadmap reconciliation computation; outbox lifecycle; briefing round-trip; the
  PUT old→new activity diff. Confirm existing test infra during planning; add minimal setup if
  none exists.

## Build order

1. **P1a** — migrations (`proposals`, `activity`, `briefings`) + activity logging + `/api/activity`.
2. **P1b** — proposals API (create/edit/approve/decline/bulk, dedupe) + MCP `propose_*` / `list_proposals`.
3. **P1c** — briefing API + MCP `post_briefing`; `/api/tasks/upcoming`.
4. **P1d** — frontend: nav restructure, Cockpit, Inbox.
5. **P1e** — routine: Step 3 proposes instead of commits; posts structured briefing; `X-TM-Actor`.
6. **P2** — `roadmap_items` migration + roadmap API + MCP sync + `/roadmap` reconciliation view; import from `project-timelines.md`.
7. **P3** — outbox table + API + MCP drain tools + routine drain step + Outbox UI; start with date propagation.

## Out of scope

- Manual day-planner (`planned_date`, Week drag board) — dropped.
- Recurring tasks.
- Multi-user / auth.
- The Express backend calling any external system directly (explicitly rejected — Claude is the
  only actuator).
- Real-time/webhook sync — the routine's daily cadence (plus on-demand runs) is the sync clock.

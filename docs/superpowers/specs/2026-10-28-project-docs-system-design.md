# Project Documentation System — Doc Matrix, Confluence Tree, Doc Check

**Date:** 2026-10-28
**Status:** Approved (design), pending implementation plan
**Revises:** Phase 2 of `2026-09-14-taskmanager-control-plane-design.md` (roadmap mirror now comes
from roadmap.mntd.net, not the JPD IDEA board; the planned `/roadmap` view becomes the Docs grid)

## Problem

Project docs get lost or never get finished:

- Most roadmap items have no doc trail. Of 22 Digital Products items in Roadmap/Build/Measure,
  5 have a PRD link, 1 a Figma link, 1 a Jira epic, 0 release notes (roadmap API, 2026-10-28).
- Confluence has no consistent structure. Half-folders exist (H1'25, H2'25, H1'26 — no H2'26),
  there is no team level, and PRDs are filed loose with three title styles.
- The per-project canonical pages are unpublished drafts in Brice's personal space, invisible to
  the team.
- TaskManager tracks 4 projects, at most 2 of them on the roadmap. Results docs live in local
  markdown and never reach Confluence.
- Nothing shows which docs a project still owes, or when they are due.

## Goals

1. Define which docs each project needs in each roadmap phase (Discovery, UX, Build, Measure),
   and when each is due.
2. A Confluence tree of Year → H1/H2 → Team → Project that mirrors the roadmap tool.
3. Make missing and overdue docs visible in Confluence, TaskManager and the daily briefing.

## Decisions

- **Systems of record.**
  - **roadmap.mntd.net** owns roadmap items, teams, stages, status and phase dates. Read through
    the `roadmap` MCP.
  - **Confluence** owns the docs.
  - **TaskManager** owns the work of producing the docs.
- **Phases** are the roadmap tool's own: Discovery, UX, Build, Measure.
- **Half = `devStartHalf`** (the half of `phases.build.start`). Items with no Build start go in
  **Unscheduled**.
- **Scope:** items in stages `roadmap`, `build` and `measure` (22 today) in Digital Products and
  its sub-teams (Online Invites, Wedding Websites, Address Book). `not-started`, `on-hold`, `done`
  and `wont-do` items are skipped. Proposals (below) are in scope before they reach the roadmap.
- **The one-pager is the entry point.** It is usually written before a project is on the roadmap.
  It ends in a Go / No-go / Parked decision, and a No-go stops every later doc requirement.
- **Experiment brief:** one doc, two tasks (plan, then results and decision). There is no separate
  readout or decision-record doc.
- **Confluence:** every level is a page (the tools can't create folders), in the Digital Products
  / Wedding Projects team space, not a personal space.
- **Write rules.**
  - Doc tasks and due-date recalculations that follow directly from the matrix are written to
    TaskManager directly, and logged.
  - New projects and roadmap ↔ project matches are **proposals** that Brice approves.
  - Confluence moves and renames of existing pages are listed for approval before they happen.
- **Roadmap write-back** (separate write token, link fields only) fills empty fields only, never
  overwrites without approval, supports a dry run and logs every write. Each link is confirmed by
  Brice before it is written. PRD links go first.

---

## 1. Project lifecycle

```
Proposal (one-pager) ──► Decision ──┬─ Go      ─► on roadmap ─► Hub + full doc matrix
                                    ├─ No-go   ─► Not Pursued (nothing further required)
                                    └─ Parked  ─► stays a proposal with a "revisit by" date
```

- **Proposal.**
  - Exists only as a Confluence one-pager under `Proposals · <Team>`.
  - The only required doc is the one-pager itself. It has no due date.
  - After 30 days without a decision it is flagged ⏳ *Awaiting decision*.
- **Decision.** A block at the top of the one-pager: `Decision: Go | No-go | Parked`, with a date
  and a one-line reason.
  - **No-go:** the page moves under `Not Pursued`.
  - **Parked:** requires a revisit-by date. The flag is raised again on that date.
  - **Go but not on the roadmap after 14 days:** flagged *Go, not on roadmap*.
- **Joining the roadmap.**
  - The check proposes a match between the one-pager and the new roadmap item. Once approved,
    the hub is created and the one-pager moves under it.
  - The one-pager's link is written to the item's `onePager` field (write-back).
  - The full matrix starts from that point.
- **Stopped later.** If a roadmap item moves to `on-hold` or `wont-do`, every doc that isn't
  done becomes ➖ *Not required*, including overdue ones, since there's no point chasing them.
  Docs already written stay ✅.

## 2. Doc matrix

The matrix lives in one config file: `shared/doc-matrix.ts`. Each row has: `doc_key`, phase,
label, a `requiredWhen` predicate, a due rule with an optional fallback, and how it is detected.

| doc_key | Phase | Doc | Required when | Due | Fallback |
|---|---|---|---|---|---|
| `hub` | — | Project hub | Always, once on the roadmap | When the item enters scope | — |
| `one_pager` | Discovery | One-pager | Always | Discovery start +2w | Entered roadmap +2w |
| `research` | Discovery | Research synthesis | UX Research phase is on | Discovery end | Build start −8w |
| `prd` | UX | Brief/PRD, built from the one-pager | Always, unless `doc_mode = one_pager_only` | Build start −2w | — |
| `figma` | UX | Figma design (link) | UX phase is on | Build start | — |
| `experiment_brief.plan` | UX | Experiment brief: plan | Measure phase is on | Build start | — |
| `jira_epic` | Build | Jira epic (link) | Always | Build start | — |
| `cs_marketing_brief` | Build | CS/Marketing brief | Hub flag "customer-facing launch" | Build end −1w | — |
| `release_notes` | Build | Release notes | Always | Build end | — |
| `metrics_snapshot` | Measure | 2-week metrics snapshot | Measure phase is on | Measure start +2w | Build end +2w |
| `experiment_brief.results` | Measure | Experiment brief: results and decision | Measure phase is on | Measure end | Build end +6w |

"Build end" stands for the release date; the roadmap API does not return a separate release field.

**Rules**

- **When a row applies.** A row is *active* once the item reaches the row's phase, or 4 weeks
  before its due date, whichever is earlier. Inactive rows are shown but never flagged.
- **Statuses.**
  - ✅ **Done:** the page is published (or the link is set) and the TaskManager task is done. For
    `experiment_brief.results`, the brief's *Results* section must also be non-empty. Link-only
    rows (`hub`, `figma`, `jira_epic`) are done as soon as the link is set, and the check marks
    their task done. Proposals' one-pagers are done once published.
  - 📝 **Draft:** the page exists but is unpublished.
  - ⏳ **Due soon:** due within 14 days.
  - 🔴 **Overdue:** past the due date and not ✅.
  - ⚪ **Missing:** no page and no link.
  - ➖ **Waived / Not required:** a waiver on the hub (with a reason), `one_pager_only`, a No-go,
    or a stopped item.
  - ❓ **Can't date:** both the anchor date and the fallback are missing. Shown as
    "Can't date: needs <field>".
- **Evidence a doc exists.**
  - The roadmap link field (`prd`, `figma`, `jiraEpic`, `releaseNotes`, later `onePager`,
    `experimentBrief`, `hub`).
  - **Or** a child page of the hub whose title ends in the doc's label.
  - If both exist and disagree, the doc shows ⚠️ *Link mismatch*. Neither side is overwritten.
- **Not in the matrix.** Kickoff, mid-build check-in, QA sign-off, the CS/Marketing share and the
  retro stay as ordinary lifecycle tasks from `project-lifecycle-template.md`. The template drops
  the rows the matrix now covers.
- **`templates/experiment-brief.md`** gains a *Results* section (outcome against success
  criteria, then Decision: ship / iterate / kill, with a date).

## 3. Confluence structure

Lives in Digital Products / Wedding Projects (`221937685`).

```
Roadmap Projects                          ← Start Here: active projects, doc health, links
├── Proposals
│   └── Proposals · Online Invites        ← roll-up: decision, age, owner
│       └── [OI] <idea> — One-Pager
├── Not Pursued
│   └── Not Pursued · Online Invites
├── 2026
│   ├── H1'26                             ← roll-up grid: project × doc status
│   │   ├── H1'26 · Address Book
│   │   ├── H1'26 · Online Invites
│   │   │   └── [OI] Messaging Center — Hub
│   │   │       ├── [OI] Messaging Center — One-Pager
│   │   │       ├── [OI] Messaging Center — Brief/PRD
│   │   │       └── [OI] Messaging Center — Experiment Brief
│   │   └── H1'26 · Wedding Websites
│   └── H2'26 / …
├── 2027 / H1'27 / …
└── Unscheduled                           ← items with no Build start, by team
```

- **Titles.** Titles are unique per space, so each level carries its context:
  `H2'26 · Online Invites`, `[OI] <roadmap name> — Hub`, `[OI] <roadmap name> — <Doc label>`.
  - Team prefixes: OI, WW, ABK. Items on the parent team use DP.
  - The roadmap name is used trimmed and otherwise verbatim.
- **Hub page.** Generated sections sit between `<!-- doc-check:start/end -->` markers (an expand
  or panel macro with a fixed local ID). The check rewrites only those sections.
  1. **Status** (generated): stage, status, team, PM/Eng/UX, all phase dates.
  2. **Doc checklist** (generated): every active matrix row with its status, due date and link.
  3. **Links** (hand-written): Slack, dashboards, anything else.
  4. **Decisions log** and **Open questions** (hand-written).
  5. **Settings** (hand-written): `doc_mode`, waivers with reasons, the customer-facing-launch
     flag.
- **Roll-ups.** Half pages, team pages and Proposals pages show generated grids, overdue first.
- **Creation.** Hubs for every in-scope item are created in one batch, including empty ones.
- **Migration** (listed for approval first):
  - H1'26 PRDs move under their hubs and are renamed. Page IDs, and so existing links, are kept.
  - The four personal-space canonical drafts become hubs. IDEA-845 and IDEA-852 (not on the
    roadmap) go to `Unscheduled` and are marked *off-roadmap*.
  - H1'25/H2'25 and the old per-team canonical docs stay where they are, with a pointer banner.
  - Items already in Build or Measure with no one-pager get `one_pager` ➖ waived ("predates
    system"). No one-pager is written after the fact.
- **Moved items.** If an item's `devStartHalf` changes, the check flags *Move to <half>*. Pages
  are never moved automatically.

## 4. TaskManager changes

**Data (Drizzle migration)**

- **New `roadmap_items` table:** `id` (roadmap item id, PK), `name`, `team_id`, `team_name`,
  `parent_team_id`, `stage`, `status`, `pm_name`, `jira_key`, `phases` (JSON), `dev_start_half`,
  `links` (JSON), `hidden`, `updated_at`, `synced_at`.
- **New columns on `projects`:** `roadmap_item_id` (nullable), `team` (OI | WW | ABK | DP),
  `docs_stage` (null = not tracked | proposal | roadmap | not_pursued; the roadmap stage itself
  is read from `roadmap_items`), `decision` (go | no_go | parked | null), `decision_date`,
  `decision_reason`, `revisit_by`, `doc_mode` (full | one_pager_only), `customer_facing`,
  `waivers` (JSON), `hub_url`, `one_pager_url`.
- **New columns on `tasks`:**
  - `doc_key` (a matrix row; nullable, since non-doc tasks have none);
  - `doc_status` (written by the check);
  - `due_rule` (readable text, e.g. "Build start −2w").
  - `doc_type` and `links` stay as they are. Existing `doc_type` values map to `doc_key`.
- **Half is never stored on projects.** It is read from `roadmap_items.dev_start_half`.

**Backend API**

- `POST /api/roadmap/sync`: upsert the snapshot. Called by the check, not by the backend itself,
  since the backend still holds no external credentials.
- `GET /api/docs/health?half=&team=&status=`: the grid data.
- `PATCH /api/projects/:id/docs`: `doc_mode`, waivers, decision.
- `POST /api/docs/apply`: the check's write step. Upserts doc tasks by `(project_id, doc_key)`,
  sets due dates and `doc_status`, and writes an activity log entry for each change.

**MCP tools:** `sync_roadmap`, `get_doc_health`, `apply_doc_check`, `set_project_decision`,
`link_project`. New projects and roadmap matches go through the Inbox as proposals. Until the
Inbox exists, Claude asks Brice in chat before calling `link_project` or creating a project.

**UI**

- **`/docs` (new):** a grid of projects × doc keys, grouped Year → Half → Team.
  - Filters for team, half and status. Overdue first.
  - Each cell links to the page or the task.
- **Project page:** a Docs panel above the board.
  - Shows the checklist, hub link and one-pager-only switch.
  - For proposals it shows Go / No-go / Parked buttons instead.
- **Sidebar:** grouped by Half → Team, plus Proposals and a collapsed Not Pursued.
- **Dashboard:** overdue and missing doc counts.

## 5. The doc check

Runs daily as a step in `daily-morning-briefing`, and on demand.

1. **Read.**
   - The roadmap: `list_roadmap_items(team="Digital Products", includeSubteams=true,
     stage="roadmap,build,measure,on-hold,wont-do")`. Stopped stages are included so their docs
     can be marked not required.
   - Confluence: descendants of `Roadmap Projects`, with publish status, decision blocks, Results
     sections and hub settings.
   - TaskManager: projects and doc tasks.
2. **Compute** each row's status, plus cross-system flags:
   - on the roadmap but no hub;
   - Go but not on the roadmap;
   - hub in the wrong half;
   - link mismatch;
   - awaiting decision.
3. **Write.**
   - `apply_doc_check` updates TaskManager.
   - The generated sections of hubs and roll-ups are rewritten.
   - Proposals are queued.
   - A **Docs** section goes into the briefing: overdue, due this week and the flags.
4. **Write-back** (only when Brice has confirmed): fill empty roadmap link fields, dry run first.

**Failure handling**

- **Roadmap MCP unavailable:** skip the roadmap step, keep the last snapshot, and show
  "Roadmap not synced since <date>" in the briefing.
- **Confluence:** calls run strictly one at a time (known Atlassian concurrency bug). A failed page
  write is retried on the next run and does not block the others.
- **Idempotent:** tasks are upserted by `(project_id, doc_key)`. Generated sections are fully
  replaced. Hand-written content is never touched.
- **Unknown or missing data** shows as ❓, never guessed.

## 6. Build order

0. **Prerequisite:** commit or set aside the uncommitted work in `Sidebar.tsx`, `TaskBoard.tsx`,
   `AppContext.tsx` and `client.ts`, which this touches.
1. **Matrix and data model:** `shared/doc-matrix.ts` with due-date and status functions; the
   migration; roadmap sync; `docs/health` and `docs/apply`. Uses the Vitest harness from
   control-plane Task 1.
2. **TaskManager UI:** `/docs` grid, project Docs panel, sidebar grouping, dashboard counts.
3. **Confluence tree:** scaffold the tree and hubs for the 22 items; migration list for approval.
4. **Doc check in the briefing:** hub and roll-up writes, the briefing section.
5. **Proposals flow:** one-pager template, decision block, Proposals and Not Pursued roll-ups,
   roadmap-match proposals.
6. **Write-back:** PRD links first, once each is confirmed, then release notes, then
   `hub` / `onePager` / `experimentBrief`.

Control-plane Phase 1 (Inbox) is needed before step 5's match proposals. Steps 1–4 do not depend
on it.

## Testing

- **Unit tests** (Vitest) for `doc-matrix.ts`:
  - each due rule, including fallbacks and ❓;
  - when a row becomes active;
  - status precedence;
  - waivers, `one_pager_only`, No-go and stopped stages;
  - `devStartHalf` grouping.
- **API tests** (supertest):
  - `docs/apply` is idempotent;
  - date recalculation is logged;
  - the health grid filters.
- **Dry run** against live data: run the check with writes disabled for the 22 items, and compare
  its output with the known gaps (17 missing PRDs; the Messaging Center PRD link on the Iteration
  item) before turning writes on.

## Open items (not blocking)

- The Messaging Center PRD (`3748462617`) is linked from *OI – Messaging Center – Iteration* but
  not from *[OI] Messaging Center* (IDEA-850). Brice to confirm which is right.
- The only On-Canvas Editing PRD in Confluence is titled "OI: On-Canvas Editing", but the roadmap
  item is under Wedding Websites. Brice to confirm the match.
- Confirm that IDEA-932 is *WW – Modular Elements* (expected: yes, same Jira key).

# TaskManager ("Asana Light") - Implementation Plan

## Overview
A lightweight task management app for product managers, organized around
Projects (epics/product areas) with Tasks underneath. Includes a Slack
paste-to-task feature for quickly capturing action items from conversations.

---

## Tech Stack

| Layer       | Choice                        | Rationale                                      |
|-------------|-------------------------------|-------------------------------------------------|
| Frontend    | React + TypeScript + Vite     | Fast dev cycle, strong typing, modern tooling   |
| Styling     | Tailwind CSS                  | Rapid UI iteration without custom CSS overhead  |
| State       | React Context + useReducer    | Sufficient for this scope, no extra deps        |
| Backend     | Node.js + Express + TypeScript| Simple REST API, shares types with frontend     |
| Database    | SQLite (via better-sqlite3)   | Zero-config, file-based, perfect for single-user|
| ORM/Query   | Drizzle ORM                   | Lightweight, type-safe, great SQLite support    |

> **Why SQLite?** For a personal PM tool, a full Postgres/MySQL setup is
> overkill. SQLite gives us a real relational DB in a single file with zero
> infrastructure. If you ever need to scale to a team, we can swap to Postgres
> with minimal Drizzle schema changes.

---

## Data Model

```
Project
├── id            (UUID)
├── name          (string)        — e.g. "Search Redesign", "Payments V2"
├── description   (text, optional)
├── status        (active | archived)
├── created_at    (timestamp)
├── updated_at    (timestamp)
│
└── Tasks[]
    ├── id            (UUID)
    ├── project_id    (FK → Project)
    ├── title         (string)
    ├── description   (text, optional)
    ├── status        (todo | in_progress | done)
    ├── priority      (low | medium | high | urgent)
    ├── due_date      (date, optional)
    ├── source        (manual | slack)
    ├── slack_raw      (text, optional)  — original Slack message text
    ├── created_at    (timestamp)
    └── updated_at    (timestamp)
```

---

## Features (by Phase)

### Phase 1 — Core (this build)
1. **Project CRUD** — create, list, view, edit, archive projects
2. **Task CRUD** — create, list, view, edit, delete tasks under a project
3. **Task Board View** — Kanban-style columns (Todo → In Progress → Done)
   with drag-and-drop
4. **Task List View** — Sortable/filterable table view
5. **Slack Paste-to-Task** — Paste a Slack message into a text box; the app
   parses it and pre-fills the task title/description. Captures the raw
   Slack text for reference.
6. **Dashboard** — Overview showing project health (task counts by status,
   overdue items)
7. **Priority & Due Dates** — Set priority levels and optional due dates;
   highlight overdue tasks

### Phase 2 — Nice-to-haves (future)
- Tags / Labels on tasks
- Search across all projects and tasks
- Recurring tasks
- Activity log / audit trail
- Slack webhook integration (auto-create tasks from Slack reactions)
- Multi-user support with auth
- Export to CSV

---

## Slack Paste-to-Task — How It Works

Since full Slack API integration requires OAuth and a Slack app, we'll start
with a practical **clipboard-based** approach:

1. User copies a Slack message (Slack's copy gives you `[timestamp] Author: message`)
2. In the app, user clicks "New Task from Slack" on a project
3. A modal opens with a large text area — user pastes the Slack content
4. The app parses the paste to extract:
   - **Author** → added to description as "Reported by: ..."
   - **Message body** → pre-fills task title (truncated) and full description
   - **Timestamp** → stored as metadata
5. User can edit the pre-filled fields before saving
6. Task is saved with `source: "slack"` and the raw text stored in `slack_raw`

This gives you 80% of the value with zero Slack setup.

---

## Project Structure

```
TaskManager/
├── frontend/                  # React + Vite app
│   ├── src/
│   │   ├── components/
│   │   │   ├── layout/        # Sidebar, Header, Layout shell
│   │   │   ├── projects/      # ProjectList, ProjectCard, ProjectForm
│   │   │   ├── tasks/         # TaskBoard, TaskList, TaskCard, TaskForm
│   │   │   ├── dashboard/     # DashboardView, StatCards
│   │   │   └── slack/         # SlackPasteModal, slack parser
│   │   ├── hooks/             # Custom React hooks
│   │   ├── context/           # App state (projects, tasks)
│   │   ├── api/               # API client functions
│   │   ├── types/             # Shared TypeScript types
│   │   ├── utils/             # Helpers (date formatting, etc.)
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── index.html
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── package.json
│
├── backend/                   # Express + SQLite API
│   ├── src/
│   │   ├── db/
│   │   │   ├── schema.ts      # Drizzle schema definitions
│   │   │   ├── migrate.ts     # Migration runner
│   │   │   └── index.ts       # DB connection
│   │   ├── routes/
│   │   │   ├── projects.ts    # /api/projects endpoints
│   │   │   └── tasks.ts       # /api/projects/:id/tasks endpoints
│   │   ├── middleware/        # Error handling, validation
│   │   └── index.ts           # Express app entry point
│   ├── tsconfig.json
│   └── package.json
│
├── shared/                    # Shared types between FE & BE
│   └── types.ts
│
├── PLAN.md
└── README.md
```

---

## API Endpoints

### Projects
| Method | Path                  | Description            |
|--------|-----------------------|------------------------|
| GET    | /api/projects         | List all projects      |
| POST   | /api/projects         | Create a project       |
| GET    | /api/projects/:id     | Get project detail     |
| PUT    | /api/projects/:id     | Update a project       |
| DELETE | /api/projects/:id     | Archive a project      |

### Tasks
| Method | Path                              | Description              |
|--------|-----------------------------------|--------------------------|
| GET    | /api/projects/:id/tasks           | List tasks for project   |
| POST   | /api/projects/:id/tasks           | Create a task            |
| GET    | /api/projects/:id/tasks/:taskId   | Get task detail          |
| PUT    | /api/projects/:id/tasks/:taskId   | Update a task            |
| DELETE | /api/projects/:id/tasks/:taskId   | Delete a task            |
| PATCH  | /api/projects/:id/tasks/:taskId/status | Quick status update |

### Dashboard
| Method | Path                  | Description                    |
|--------|-----------------------|--------------------------------|
| GET    | /api/dashboard        | Aggregated stats across projects|

---

## Implementation Steps

### Step 1: Project scaffolding
- Initialize frontend (Vite + React + TypeScript)
- Initialize backend (Express + TypeScript)
- Set up shared types
- Configure Tailwind CSS
- Add .gitignore

### Step 2: Database & API
- Define Drizzle schema (projects, tasks tables)
- Set up SQLite connection and migrations
- Implement project CRUD endpoints
- Implement task CRUD endpoints
- Implement dashboard aggregation endpoint
- Add input validation and error handling

### Step 3: Frontend — Layout & Navigation
- Build app shell (sidebar with project list, main content area)
- Set up React Router (dashboard, project view, etc.)
- Build state management (Context + useReducer)
- Wire up API client

### Step 4: Frontend — Project Management
- Project list view
- Create/edit project form
- Project detail page (with task views)

### Step 5: Frontend — Task Management
- Task board (Kanban columns with drag-and-drop)
- Task list view (sortable table)
- Create/edit task form with priority and due date
- Task status quick-toggle

### Step 6: Slack Paste-to-Task
- Build Slack message parser (regex-based extraction)
- Build paste modal UI
- Pre-fill task form from parsed Slack content
- Store raw Slack text on task

### Step 7: Dashboard
- Build dashboard view with stat cards
- Show per-project health (task breakdown by status)
- Highlight overdue tasks

### Step 8: Polish
- Loading states and error boundaries
- Empty states (no projects yet, no tasks yet)
- Responsive layout tweaks
- Final README with setup instructions

---

## Suggestions & Opinions

1. **Start with the board view as the default** — As a PM, you'll spend most
   time moving tasks across statuses. The Kanban board makes that tactile.

2. **Keep the Slack feature simple** — The paste approach is surprisingly
   effective. I've seen teams build complex Slack bots that nobody uses,
   while a simple paste-and-parse covers the real workflow: "I saw something
   in Slack, I need to track it."

3. **SQLite is the right call** — This is a personal tool. No Docker, no
   database server, no connection strings. Just run it and it works. The DB
   file can even be checked into git if you want portable state.

4. **No auth in Phase 1** — For a single-user tool, auth is unnecessary
   friction. We can add it later if this becomes a team tool.

5. **Consider adding a "Quick Add" shortcut** — A persistent input bar at the
   top of a project view for rapid task entry (just a title, defaults to
   "todo" status and "medium" priority). Great for standup capture.

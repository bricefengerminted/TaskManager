#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = process.env.TASKMANAGER_API_URL || "http://localhost:3001/api";

// --- HTTP helpers ---

async function api(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", "X-Actor": "claude" },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(e: any) {
  return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
}

// --- MCP Server ---

const server = new McpServer({
  name: "taskmanager",
  version: "1.0.0",
});

// --- Tools ---

server.tool(
  "list_projects",
  "List all active projects with task counts",
  {},
  async () => {
    try {
      const projects = await api("/projects");
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(projects, null, 2),
          },
        ],
      };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  "dashboard",
  "Get system-wide task statistics: totals, by status, overdue count, and per-project breakdowns",
  {},
  async () => {
    try {
      const stats = await api("/dashboard");
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(stats, null, 2),
          },
        ],
      };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  "list_tasks",
  "List tasks in a project, optionally filtered by status. Use project_id 'general' for the default project.",
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
      .describe("Only tasks with this doc_type (e.g. experiment_brief, release_notes)"),
  },
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
);

const linkSchema = z.object({
  type: z.string().describe("confluence | jira | figma | local | other"),
  label: z.string(),
  url: z.string(),
});

server.tool(
  "create_task",
  "Create a new task. Use for action items from meetings, Slack threads, or manual entry.",
  {
    title: z.string().describe("Task title"),
    project_id: z.string().default("general").describe("Project ID (default: 'general')"),
    description: z.string().optional().describe("Task description or context"),
    priority: z.enum(["low", "medium", "high", "urgent"]).default("medium").describe("Priority level"),
    due_date: z.string().optional().describe("Due date in YYYY-MM-DD format"),
    status: z.enum(["todo", "in_progress", "done"]).default("todo").describe("Initial status"),
    links: z.array(linkSchema).optional().describe("Artifact links to attach on creation"),
    doc_type: z.string().optional().describe("Lifecycle doc type, e.g. experiment_brief / release_notes"),
  },
  async ({ title, project_id, description, priority, due_date, status, links, doc_type }) => {
    try {
      const task = await api(`/projects/${project_id}/tasks`, {
        method: "POST",
        body: JSON.stringify({
          title,
          description: description || "",
          priority,
          due_date: due_date || null,
          status,
          links: links || [],
          doc_type: doc_type ?? null,
        }),
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Created task: "${task.title}" (${task.id})\nStatus: ${task.status} | Priority: ${task.priority}${task.due_date ? ` | Due: ${task.due_date}` : ""}`,
          },
        ],
      };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  "update_task",
  "Update an existing task's title, description, priority, due date, or status.",
  {
    task_id: z.string().describe("Task ID"),
    project_id: z.string().default("general").describe("Project ID (default: 'general')"),
    title: z.string().optional().describe("New title"),
    description: z.string().optional().describe("New description"),
    status: z.enum(["todo", "in_progress", "done"]).optional().describe("New status"),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional().describe("New priority"),
    due_date: z.string().optional().describe("New due date (YYYY-MM-DD) or empty string to clear"),
    links: z.array(linkSchema).optional().describe("Replace the task's artifact links with this list"),
    doc_type: z.string().optional().describe("Lifecycle doc type, e.g. experiment_brief / release_notes"),
  },
  async ({ task_id, project_id, title, description, status, priority, due_date, links, doc_type }) => {
    try {
      const body: Record<string, any> = {};
      if (title !== undefined) body.title = title;
      if (description !== undefined) body.description = description;
      if (status !== undefined) body.status = status;
      if (priority !== undefined) body.priority = priority;
      if (due_date !== undefined) body.due_date = due_date || null;
      if (links !== undefined) body.links = links;
      if (doc_type !== undefined) body.doc_type = doc_type;

      const task = await api(`/projects/${project_id}/tasks/${task_id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Updated task: "${task.title}"\nStatus: ${task.status} | Priority: ${task.priority}${task.due_date ? ` | Due: ${task.due_date}` : ""}`,
          },
        ],
      };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }
);

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

server.tool(
  "complete_task",
  "Mark a task as done.",
  {
    task_id: z.string().describe("Task ID"),
    project_id: z.string().default("general").describe("Project ID (default: 'general')"),
  },
  async ({ task_id, project_id }) => {
    try {
      const task = await api(`/projects/${project_id}/tasks/${task_id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: "done" }),
      });

      return {
        content: [{ type: "text" as const, text: `✓ Completed: "${task.title}"` }],
      };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  "delete_task",
  "Permanently delete a task.",
  {
    task_id: z.string().describe("Task ID"),
    project_id: z.string().default("general").describe("Project ID (default: 'general')"),
  },
  async ({ task_id, project_id }) => {
    try {
      await api(`/projects/${project_id}/tasks/${task_id}`, { method: "DELETE" });
      return {
        content: [{ type: "text" as const, text: `Deleted task ${task_id}` }],
      };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  "create_project",
  "Create a new project to organize tasks.",
  {
    name: z.string().describe("Project name"),
    description: z.string().optional().describe("Project description"),
  },
  async ({ name, description }) => {
    try {
      const project = await api("/projects", {
        method: "POST",
        body: JSON.stringify({ name, description: description || "" }),
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Created project: "${project.name}" (${project.id})`,
          },
        ],
      };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }
);

// --- Doc system ---

server.tool(
  "sync_roadmap",
  "Push a roadmap snapshot into TaskManager. Pass the `items` array exactly as returned by the roadmap MCP's list_roadmap_items. Returns suggested project matches (never applied automatically) and unlinked items.",
  { items: z.array(z.record(z.string(), z.any())).describe("Items from roadmap list_roadmap_items") },
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
        z.string(),
        z.object({
          page_url: z.string().nullable().optional(),
          published: z.boolean().optional(),
          results_filled: z.boolean().optional(),
        }).nullable()
      )
      .optional()
      .describe("Per doc_key: the hub child page found in Confluence; null clears stored evidence"),
    dry_run: z
      .boolean()
      .optional()
      .describe("Return planned changes without writing anything. Task ids in a dry-run `created` list don't exist."),
  },
  async ({ project_id, evidence, dry_run }) => {
    try {
      return ok(await api("/docs/apply", { method: "POST", body: JSON.stringify({ project_id, evidence, dry_run }) }));
    } catch (e: any) {
      return fail(e);
    }
  }
);

server.tool(
  "resolve_due_conflict",
  "Resolve a doc task whose due date differs from the doc matrix (listed in apply_doc_check `conflicts`). accept = use the matrix date; keep = pin the current date so it is never re-dated. Only call with the user's decision.",
  {
    task_id: z.string(),
    action: z.enum(["accept", "keep"]),
  },
  async ({ task_id, action }) => {
    try {
      return ok(await api("/docs/resolve-conflict", { method: "POST", body: JSON.stringify({ task_id, action }) }));
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
  "Set a project's doc-system fields: roadmap item link, hub/one-pager URLs, team, doc mode, customer-facing flag, waivers, docs_stage. Only link a roadmap item after the user has approved that match. waivers replaces the whole set; include existing waivers to keep them.",
  {
    project_id: z.string(),
    roadmap_item_id: z.string().nullable().optional(),
    docs_stage: z.enum(["proposal", "roadmap", "not_pursued"]).nullable().optional(),
    hub_url: z.string().nullable().optional(),
    one_pager_url: z.string().nullable().optional(),
    team: z.string().nullable().optional(),
    doc_mode: z.enum(["full", "one_pager_only"]).optional(),
    customer_facing: z.boolean().optional(),
    waivers: z.record(z.string(), z.string()).optional().describe("doc_key → reason"),
  },
  async ({ project_id, ...fields }) => {
    try {
      return ok(await api(`/projects/${project_id}/docs`, { method: "PATCH", body: JSON.stringify(fields) }));
    } catch (e: any) {
      return fail(e);
    }
  }
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("TaskManager MCP server running on stdio");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = process.env.TASKMANAGER_API_URL || "http://localhost:3001/api";

// --- HTTP helpers ---

async function api(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
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
      .describe("Only tasks with this doc_type (e.g. experiment_brief, release_notes, metrics_snapshot)"),
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
    doc_type: z.string().optional().describe("Lifecycle doc type, e.g. experiment_brief / release_notes / metrics_snapshot"),
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
    doc_type: z.string().optional().describe("Lifecycle doc type, e.g. experiment_brief / release_notes / metrics_snapshot"),
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

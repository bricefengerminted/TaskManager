// Shared types between frontend and backend

import type { DocKey, DocRowResult, DocStatus } from './doc-matrix';
export type { DocKey, DocRowResult, DocStatus } from './doc-matrix';

export type DocsStage = 'proposal' | 'roadmap' | 'not_pursued';
export type Decision = 'go' | 'no_go' | 'parked';
export type DocMode = 'full' | 'one_pager_only';

export type ProjectStatus = 'active' | 'archived';
export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskSource = 'manual' | 'slack';

export interface TaskLink {
  type: string;
  label: string;
  url: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
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
  task_counts?: {
    todo: number;
    in_progress: number;
    done: number;
    overdue: number;
  };
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  position: number;
  images: string[];
  links: TaskLink[];
  doc_type: string | null;
  doc_key?: DocKey | null;
  doc_status?: DocStatus | null;
  due_rule?: string | null;
  source: TaskSource;
  slack_raw: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  status?: ProjectStatus;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  due_date?: string | null;
  source?: TaskSource;
  slack_raw?: string | null;
  links?: TaskLink[];
  doc_type?: string | null;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  due_date?: string | null;
  images?: string[];
  links?: TaskLink[];
  doc_type?: string | null;
}

export interface DashboardStats {
  total_projects: number;
  total_tasks: number;
  tasks_by_status: {
    todo: number;
    in_progress: number;
    done: number;
  };
  overdue_tasks: number;
  projects: Project[];
}

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

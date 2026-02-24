// Shared types between frontend and backend

export type ProjectStatus = 'active' | 'archived';
export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskSource = 'manual' | 'slack';

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
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
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  due_date?: string | null;
  images?: string[];
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

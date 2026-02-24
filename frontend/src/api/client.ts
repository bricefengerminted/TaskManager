const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  // Projects
  getProjects: () => request<import('@shared/types').Project[]>('/projects'),
  getArchivedProjects: () => request<import('@shared/types').Project[]>('/projects/archived'),
  getProject: (id: string) => request<import('@shared/types').Project>(`/projects/${id}`),
  createProject: (data: import('@shared/types').CreateProjectInput) =>
    request<import('@shared/types').Project>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  updateProject: (id: string, data: import('@shared/types').UpdateProjectInput) =>
    request<import('@shared/types').Project>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  archiveProject: (id: string) =>
    request<void>(`/projects/${id}`, { method: 'DELETE' }),

  // Tasks
  getTasks: (projectId: string) =>
    request<import('@shared/types').Task[]>(`/projects/${projectId}/tasks`),
  createTask: (projectId: string, data: import('@shared/types').CreateTaskInput) =>
    request<import('@shared/types').Task>(`/projects/${projectId}/tasks`, { method: 'POST', body: JSON.stringify(data) }),
  updateTask: (projectId: string, taskId: string, data: import('@shared/types').UpdateTaskInput) =>
    request<import('@shared/types').Task>(`/projects/${projectId}/tasks/${taskId}`, { method: 'PUT', body: JSON.stringify(data) }),
  updateTaskStatus: (projectId: string, taskId: string, status: import('@shared/types').TaskStatus) =>
    request<import('@shared/types').Task>(`/projects/${projectId}/tasks/${taskId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  deleteTask: (projectId: string, taskId: string) =>
    request<void>(`/projects/${projectId}/tasks/${taskId}`, { method: 'DELETE' }),

  // Dashboard
  getDashboard: () => request<import('@shared/types').DashboardStats>('/dashboard'),
};

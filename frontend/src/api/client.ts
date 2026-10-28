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
  restoreProject: (id: string) =>
    request<import('@shared/types').Project>(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'active' }),
    }),

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
  reorderTasks: (projectId: string, columns: Record<string, string[]>) =>
    request<import('@shared/types').Task[]>(`/projects/${projectId}/tasks/reorder`, {
      method: 'PATCH',
      body: JSON.stringify({ columns }),
    }),
  deleteTask: (projectId: string, taskId: string) =>
    request<void>(`/projects/${projectId}/tasks/${taskId}`, { method: 'DELETE' }),

  // Uploads
  uploadImages: async (files: File[]): Promise<{ urls: string[] }> => {
    const form = new FormData();
    files.forEach((f) => form.append('images', f));
    const res = await fetch(`${BASE}/uploads`, { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Upload failed');
    }
    return res.json();
  },

  // Docs
  getDocHealth: (params: { half?: string; team?: string; status?: string; project_id?: string } = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v) as [string, string][]
    ).toString();
    return request<import('@shared/types').DocHealthResponse>(`/docs/health${qs ? `?${qs}` : ''}`);
  },
  updateProjectDocs: (id: string, data: import('@shared/types').ProjectDocsInput) =>
    request<import('@shared/types').Project>(`/projects/${id}/docs`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Dashboard
  getDashboard: () => request<import('@shared/types').DashboardStats>('/dashboard'),
};

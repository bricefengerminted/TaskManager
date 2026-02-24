import React, { createContext, useContext, useReducer, useCallback } from 'react';
import type { Project, Task, DashboardStats } from '@shared/types';
import { api } from '../api/client';

interface AppState {
  projects: Project[];
  currentProject: Project | null;
  tasks: Task[];
  dashboard: DashboardStats | null;
  loading: boolean;
  error: string | null;
}

type Action =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_PROJECTS'; payload: Project[] }
  | { type: 'ADD_PROJECT'; payload: Project }
  | { type: 'UPDATE_PROJECT'; payload: Project }
  | { type: 'REMOVE_PROJECT'; payload: string }
  | { type: 'SET_CURRENT_PROJECT'; payload: Project | null }
  | { type: 'SET_TASKS'; payload: Task[] }
  | { type: 'ADD_TASK'; payload: Task }
  | { type: 'UPDATE_TASK'; payload: Task }
  | { type: 'REMOVE_TASK'; payload: string }
  | { type: 'SET_DASHBOARD'; payload: DashboardStats };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_LOADING': return { ...state, loading: action.payload };
    case 'SET_ERROR': return { ...state, error: action.payload };
    case 'SET_PROJECTS': return { ...state, projects: action.payload };
    case 'ADD_PROJECT': return { ...state, projects: [...state.projects, action.payload] };
    case 'UPDATE_PROJECT':
      return { ...state, projects: state.projects.map(p => p.id === action.payload.id ? action.payload : p) };
    case 'REMOVE_PROJECT':
      return { ...state, projects: state.projects.filter(p => p.id !== action.payload) };
    case 'SET_CURRENT_PROJECT': return { ...state, currentProject: action.payload };
    case 'SET_TASKS': return { ...state, tasks: action.payload };
    case 'ADD_TASK': return { ...state, tasks: [...state.tasks, action.payload] };
    case 'UPDATE_TASK':
      return { ...state, tasks: state.tasks.map(t => t.id === action.payload.id ? action.payload : t) };
    case 'REMOVE_TASK':
      return { ...state, tasks: state.tasks.filter(t => t.id !== action.payload) };
    case 'SET_DASHBOARD': return { ...state, dashboard: action.payload };
    default: return state;
  }
}

const initialState: AppState = {
  projects: [],
  currentProject: null,
  tasks: [],
  dashboard: null,
  loading: false,
  error: null,
};

interface AppContextValue {
  state: AppState;
  loadProjects: () => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  createProject: (name: string, description?: string) => Promise<Project>;
  updateProject: (id: string, data: Parameters<typeof api.updateProject>[1]) => Promise<void>;
  archiveProject: (id: string) => Promise<void>;
  loadTasks: (projectId: string) => Promise<void>;
  createTask: (projectId: string, data: Parameters<typeof api.createTask>[1]) => Promise<Task>;
  updateTask: (projectId: string, taskId: string, data: Parameters<typeof api.updateTask>[2]) => Promise<void>;
  updateTaskStatus: (projectId: string, taskId: string, status: import('@shared/types').TaskStatus) => Promise<void>;
  deleteTask: (projectId: string, taskId: string) => Promise<void>;
  loadDashboard: () => Promise<void>;
  clearError: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const loadProjects = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const projects = await api.getProjects();
      dispatch({ type: 'SET_PROJECTS', payload: projects });
    } catch (e) {
      dispatch({ type: 'SET_ERROR', payload: (e as Error).message });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, []);

  const loadProject = useCallback(async (id: string) => {
    try {
      const project = await api.getProject(id);
      dispatch({ type: 'SET_CURRENT_PROJECT', payload: project });
    } catch (e) {
      dispatch({ type: 'SET_ERROR', payload: (e as Error).message });
    }
  }, []);

  const createProject = useCallback(async (name: string, description = '') => {
    const project = await api.createProject({ name, description });
    dispatch({ type: 'ADD_PROJECT', payload: project });
    return project;
  }, []);

  const updateProject = useCallback(async (id: string, data: Parameters<typeof api.updateProject>[1]) => {
    const updated = await api.updateProject(id, data);
    dispatch({ type: 'UPDATE_PROJECT', payload: updated });
    if (state.currentProject?.id === id) {
      dispatch({ type: 'SET_CURRENT_PROJECT', payload: updated });
    }
  }, [state.currentProject]);

  const archiveProject = useCallback(async (id: string) => {
    await api.archiveProject(id);
    dispatch({ type: 'REMOVE_PROJECT', payload: id });
  }, []);

  const loadTasks = useCallback(async (projectId: string) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const tasks = await api.getTasks(projectId);
      dispatch({ type: 'SET_TASKS', payload: tasks });
    } catch (e) {
      dispatch({ type: 'SET_ERROR', payload: (e as Error).message });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, []);

  const createTask = useCallback(async (projectId: string, data: Parameters<typeof api.createTask>[1]) => {
    const task = await api.createTask(projectId, data);
    dispatch({ type: 'ADD_TASK', payload: task });
    return task;
  }, []);

  const updateTask = useCallback(async (projectId: string, taskId: string, data: Parameters<typeof api.updateTask>[2]) => {
    const updated = await api.updateTask(projectId, taskId, data);
    dispatch({ type: 'UPDATE_TASK', payload: updated });
  }, []);

  const updateTaskStatus = useCallback(async (projectId: string, taskId: string, status: import('@shared/types').TaskStatus) => {
    const updated = await api.updateTaskStatus(projectId, taskId, status);
    dispatch({ type: 'UPDATE_TASK', payload: updated });
  }, []);

  const deleteTask = useCallback(async (projectId: string, taskId: string) => {
    await api.deleteTask(projectId, taskId);
    dispatch({ type: 'REMOVE_TASK', payload: taskId });
  }, []);

  const loadDashboard = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const dashboard = await api.getDashboard();
      dispatch({ type: 'SET_DASHBOARD', payload: dashboard });
    } catch (e) {
      dispatch({ type: 'SET_ERROR', payload: (e as Error).message });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, []);

  const clearError = useCallback(() => dispatch({ type: 'SET_ERROR', payload: null }), []);

  return (
    <AppContext.Provider value={{
      state, loadProjects, loadProject, createProject, updateProject, archiveProject,
      loadTasks, createTask, updateTask, updateTaskStatus, deleteTask, loadDashboard, clearError,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

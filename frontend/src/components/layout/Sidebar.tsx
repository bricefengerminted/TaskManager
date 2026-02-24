import { Link, useLocation } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useEffect } from 'react';

export function Sidebar() {
  const { state, loadProjects } = useApp();
  const location = useLocation();

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  return (
    <aside className="w-64 bg-slate-900 text-slate-100 flex flex-col min-h-screen">
      <div className="px-6 py-5 border-b border-slate-700">
        <h1 className="text-lg font-bold tracking-tight">TaskManager</h1>
        <p className="text-xs text-slate-400 mt-0.5">Asana Light</p>
      </div>

      <nav className="flex-1 overflow-y-auto py-4">
        <div className="px-3 mb-2">
          <Link
            to="/"
            className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              location.pathname === '/' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            Dashboard
          </Link>
        </div>

        <div className="px-3 mt-4">
          <div className="flex items-center justify-between px-3 mb-1">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Projects</span>
            <Link to="/projects/new" className="text-slate-400 hover:text-white transition-colors" title="New project">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </Link>
          </div>

          {state.projects.map((project) => (
            <Link
              key={project.id}
              to={`/projects/${project.id}`}
              className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                location.pathname.startsWith(`/projects/${project.id}`)
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-indigo-400 flex-shrink-0" />
              <span className="truncate">{project.name}</span>
              {project.task_counts && project.task_counts.todo + project.task_counts.in_progress > 0 && (
                <span className="ml-auto text-xs bg-slate-700 text-slate-300 rounded-full px-1.5 py-0.5">
                  {project.task_counts.todo + project.task_counts.in_progress}
                </span>
              )}
            </Link>
          ))}

          {state.projects.length === 0 && !state.loading && (
            <p className="px-3 text-xs text-slate-500 mt-2">No projects yet</p>
          )}
        </div>
      </nav>

      <div className="px-6 py-4 border-t border-slate-700">
        <Link to="/projects/new" className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Project
        </Link>
      </div>
    </aside>
  );
}

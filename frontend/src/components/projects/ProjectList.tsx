import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../context/AppContext';

export function ProjectList() {
  const { state, loadProjects } = useApp();

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Projects</h2>
        <Link to="/projects/new" className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          New Project
        </Link>
      </div>

      {state.loading && <p className="text-slate-500">Loading...</p>}

      {!state.loading && state.projects.length === 0 && (
        <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
          <p className="text-slate-500 mb-4">No projects yet. Create your first one!</p>
          <Link to="/projects/new" className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
            Create Project
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {state.projects.map((project) => (
          <Link key={project.id} to={`/projects/${project.id}`} className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md hover:border-indigo-200 transition-all group">
            <div className="flex items-start justify-between mb-3">
              <h3 className="font-semibold text-slate-800 group-hover:text-indigo-600 transition-colors">{project.name}</h3>
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">{project.status}</span>
            </div>
            {project.description && (
              <p className="text-sm text-slate-500 mb-4 line-clamp-2">{project.description}</p>
            )}
            {project.task_counts && (
              <div className="flex gap-3 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-slate-300" />
                  {project.task_counts.todo} todo
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-blue-400" />
                  {project.task_counts.in_progress} in progress
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-green-400" />
                  {project.task_counts.done} done
                </span>
                {project.task_counts.overdue > 0 && (
                  <span className="flex items-center gap-1 text-red-500">
                    <span className="w-2 h-2 rounded-full bg-red-400" />
                    {project.task_counts.overdue} overdue
                  </span>
                )}
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

import { Link, useLocation } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useEffect, useState } from 'react';
import type { Project } from '@shared/types';
import { halfLabel } from '../../utils';

type SidebarGroup = { key: string; label: string; teams: [string, Project[]][] };

function groupSidebarProjects(projects: Project[]): SidebarGroup[] {
  const groups = new Map<string, Map<string, Project[]>>();
  for (const p of projects) {
    const key =
      p.docs_stage === 'not_pursued' ? '4-not-pursued'
      : p.docs_stage === 'proposal' ? '2-proposals'
      : p.dev_start_half ? `1-${p.dev_start_half}`
      : '3-other';
    const teams = groups.get(key) ?? new Map<string, Project[]>();
    const team = p.team ?? '';
    teams.set(team, [...(teams.get(team) ?? []), p]);
    groups.set(key, teams);
  }
  const label = (key: string) =>
    key === '2-proposals' ? 'Proposals' : key === '3-other' ? 'Other' : key === '4-not-pursued' ? 'Not Pursued' : halfLabel(key.slice(2));
  return [...groups.entries()]
    .sort(([a], [b]) => {
      const ra = a.startsWith('1-') ? 1 : 2;
      const rb = b.startsWith('1-') ? 1 : 2;
      if (ra !== rb) return ra - rb;
      return ra === 1 ? b.localeCompare(a) : a.localeCompare(b);
    })
    .map(([key, teams]) => ({
      key,
      label: label(key),
      teams: [...teams.entries()].sort(([a], [b]) => a.localeCompare(b)),
    }));
}

function ProjectLink({ project, active }: { project: Project; active: boolean }) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
        active ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
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
  );
}

export function Sidebar() {
  const { state, loadProjects, loadArchivedProjects, restoreProject } = useApp();
  const location = useLocation();
  const [showArchived, setShowArchived] = useState(false);
  const [showNotPursued, setShowNotPursued] = useState(false);
  const groups = groupSidebarProjects(state.projects);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (showArchived) {
      loadArchivedProjects();
    }
  }, [showArchived, loadArchivedProjects]);

  const handleRestore = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    await restoreProject(id);
  };

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
          <Link
            to="/docs"
            className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              location.pathname === '/docs' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Docs
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

          {groups.map((g) => {
            const collapsed = g.key === '4-not-pursued' && !showNotPursued;
            return (
              <div key={g.key} className="mt-3">
                {g.key === '4-not-pursued' ? (
                  <button onClick={() => setShowNotPursued(!showNotPursued)} className="px-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    {showNotPursued ? '▾' : '▸'} {g.label}
                  </button>
                ) : (
                  <p className="px-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{g.label}</p>
                )}
                {!collapsed && g.teams.map(([team, projects]) => (
                  <div key={team || 'none'}>
                    {team && <p className="px-3 mt-1 text-[11px] text-slate-500">{team}</p>}
                    {projects.map((project) => (
                      <ProjectLink
                        key={project.id}
                        project={project}
                        active={location.pathname.startsWith(`/projects/${project.id}`)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            );
          })}

          {state.projects.length === 0 && !state.loading && (
            <p className="px-3 text-xs text-slate-500 mt-2">No projects yet</p>
          )}
        </div>

        {/* Archived Projects */}
        <div className="px-3 mt-6">
          <button
            onClick={() => setShowArchived(!showArchived)}
            className="flex items-center gap-2 px-3 mb-1 w-full text-left"
          >
            <svg
              className={`w-3 h-3 text-slate-500 transition-transform ${showArchived ? 'rotate-90' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Archived</span>
            {state.archivedProjects.length > 0 && (
              <span className="text-xs text-slate-600 ml-auto">{state.archivedProjects.length}</span>
            )}
          </button>

          {showArchived && (
            <>
              {state.archivedProjects.map((project) => (
                <div
                  key={project.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-slate-500 group"
                >
                  <span className="w-2 h-2 rounded-full bg-slate-600 flex-shrink-0" />
                  <span className="truncate flex-1">{project.name}</span>
                  <button
                    onClick={(e) => handleRestore(e, project.id)}
                    className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-green-400 transition-all flex-shrink-0"
                    title="Restore project"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                    </svg>
                  </button>
                </div>
              ))}
              {state.archivedProjects.length === 0 && (
                <p className="px-3 text-xs text-slate-600 mt-1">No archived projects</p>
              )}
            </>
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

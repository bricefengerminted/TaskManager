import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { isOverdue, formatDate } from '../../utils';

export function Dashboard() {
  const { state, loadDashboard } = useApp();

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const { dashboard } = state;

  if (state.loading && !dashboard) {
    return <div className="p-8 text-slate-500">Loading...</div>;
  }

  if (!dashboard) {
    return <div className="p-8 text-slate-500">No data yet. Create a project to get started.</div>;
  }

  const donePercent = dashboard.total_tasks > 0
    ? Math.round((dashboard.tasks_by_status.done / dashboard.total_tasks) * 100)
    : 0;

  return (
    <div className="p-8">
      <h2 className="text-2xl font-bold text-slate-800 mb-6">Dashboard</h2>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Active Projects" value={dashboard.total_projects} color="indigo" />
        <StatCard label="Total Tasks" value={dashboard.total_tasks} color="slate" />
        <StatCard label="Completed" value={`${donePercent}%`} color="green" />
        <StatCard label="Overdue" value={dashboard.overdue_tasks} color={dashboard.overdue_tasks > 0 ? 'red' : 'slate'} />
      </div>

      {/* Task status breakdown */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
        <h3 className="font-semibold text-slate-700 mb-4">Task Status Overview</h3>
        <div className="flex gap-4">
          <StatusBar label="To Do" count={dashboard.tasks_by_status.todo} total={dashboard.total_tasks} color="bg-slate-300" />
          <StatusBar label="In Progress" count={dashboard.tasks_by_status.in_progress} total={dashboard.total_tasks} color="bg-blue-400" />
          <StatusBar label="Done" count={dashboard.tasks_by_status.done} total={dashboard.total_tasks} color="bg-green-400" />
        </div>
      </div>

      {/* Projects list */}
      {dashboard.total_projects === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
          <p className="text-slate-500 mb-4">No projects yet.</p>
          <Link to="/projects/new" className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
            Create your first project
          </Link>
        </div>
      ) : (
        <div>
          <h3 className="font-semibold text-slate-700 mb-3">Projects</h3>
          <div className="space-y-3">
            {dashboard.projects.map((project) => {
              const tc = project.task_counts ?? { todo: 0, in_progress: 0, done: 0, overdue: 0 };
              const total = tc.todo + tc.in_progress + tc.done;
              const done = tc.done;
              const pct = total > 0 ? Math.round((done / total) * 100) : 0;

              return (
                <Link
                  key={project.id}
                  to={`/projects/${project.id}`}
                  className="block bg-white rounded-xl border border-slate-200 p-4 hover:shadow-sm hover:border-indigo-200 transition-all"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-slate-800">{project.name}</span>
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      {tc.overdue > 0 && (
                        <span className="text-red-500 font-medium">⚠ {tc.overdue} overdue</span>
                      )}
                      <span>{tc.in_progress} in progress</span>
                      <span className="font-medium text-slate-700">{pct}%</span>
                    </div>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-1.5">
                    <div
                      className="bg-indigo-500 h-1.5 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex gap-3 mt-2 text-xs text-slate-400">
                    <span>{tc.todo} todo</span>
                    <span>{tc.in_progress} in progress</span>
                    <span>{tc.done} done</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  const colors: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-700',
    slate: 'bg-slate-50 text-slate-700',
    green: 'bg-green-50 text-green-700',
    red: 'bg-red-50 text-red-700',
  };
  return (
    <div className={`rounded-xl p-4 ${colors[color] ?? colors.slate}`}>
      <p className="text-xs font-medium opacity-70 mb-1">{label}</p>
      <p className="text-3xl font-bold">{value}</p>
    </div>
  );
}

function StatusBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex-1">
      <div className="flex justify-between text-xs text-slate-600 mb-1">
        <span>{label}</span>
        <span className="font-medium">{count}</span>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-2">
        <div className={`${color} h-2 rounded-full`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

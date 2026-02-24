import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { TaskBoard } from '../tasks/TaskBoard';
import { TaskList } from '../tasks/TaskList';
import { TaskForm } from '../tasks/TaskForm';
import { SlackPasteModal } from '../slack/SlackPasteModal';

type ViewMode = 'board' | 'list';

export function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { state, loadProject, loadTasks, archiveProject } = useApp();
  const [viewMode, setViewMode] = useState<ViewMode>('board');
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [showSlackModal, setShowSlackModal] = useState(false);
  const [editingTask, setEditingTask] = useState<import('@shared/types').Task | null>(null);

  useEffect(() => {
    if (projectId) {
      loadProject(projectId);
      loadTasks(projectId);
    }
  }, [projectId, loadProject, loadTasks]);

  const project = state.currentProject?.id === projectId ? state.currentProject : null;

  const handleArchive = async () => {
    if (!projectId) return;
    if (!confirm('Archive this project?')) return;
    await archiveProject(projectId);
    navigate('/');
  };

  if (!project && !state.loading) {
    return <div className="p-8 text-slate-500">Project not found.</div>;
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-8 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
              <Link to="/" className="hover:text-indigo-600">Home</Link>
              <span>/</span>
              <span className="text-slate-700 font-medium">{project?.name ?? '...'}</span>
            </div>
            {project?.description && (
              <p className="text-sm text-slate-500">{project.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* View toggles */}
            <div className="flex border border-slate-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode('board')}
                className={`px-3 py-1.5 text-sm ${viewMode === 'board' ? 'bg-slate-100 text-slate-800 font-medium' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                Board
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`px-3 py-1.5 text-sm ${viewMode === 'list' ? 'bg-slate-100 text-slate-800 font-medium' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                List
              </button>
            </div>

            <button
              onClick={() => setShowSlackModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <span>Slack →</span>
            </button>

            <button
              onClick={() => { setEditingTask(null); setShowTaskForm(true); }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
            >
              + Add Task
            </button>

            <Link to={`/projects/${projectId}/edit`} className="p-1.5 text-slate-400 hover:text-slate-600">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </Link>

            <button onClick={handleArchive} className="p-1.5 text-slate-400 hover:text-red-500" title="Archive project">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {state.loading ? (
          <div className="p-8 text-slate-500">Loading tasks...</div>
        ) : viewMode === 'board' ? (
          <TaskBoard
            projectId={projectId!}
            tasks={state.tasks}
            onEditTask={(task) => { setEditingTask(task); setShowTaskForm(true); }}
          />
        ) : (
          <TaskList
            projectId={projectId!}
            tasks={state.tasks}
            onEditTask={(task) => { setEditingTask(task); setShowTaskForm(true); }}
          />
        )}
      </div>

      {/* Quick Add Bar */}
      {!showTaskForm && (
        <div className="bg-white border-t border-slate-200 px-8 py-3">
          <QuickAddTask projectId={projectId!} />
        </div>
      )}

      {/* Task Form Modal */}
      {showTaskForm && (
        <TaskForm
          projectId={projectId!}
          task={editingTask}
          onClose={() => { setShowTaskForm(false); setEditingTask(null); }}
        />
      )}

      {/* Slack Modal */}
      {showSlackModal && (
        <SlackPasteModal
          projectId={projectId!}
          onClose={() => setShowSlackModal(false)}
        />
      )}
    </div>
  );
}

function QuickAddTask({ projectId }: { projectId: string }) {
  const { createTask } = useApp();
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await createTask(projectId, { title, status: 'todo', priority: 'medium' });
      setTitle('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Quick add task... (press Enter)"
        className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        disabled={saving}
      />
      <button type="submit" disabled={saving || !title.trim()} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg text-sm font-medium">
        Add
      </button>
    </form>
  );
}

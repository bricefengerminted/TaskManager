import type { Task, TaskStatus } from '@shared/types';
import { useApp } from '../../context/AppContext';
import { PRIORITY_COLORS, PRIORITY_LABELS, STATUS_LABELS, formatDate, isOverdue } from '../../utils';

interface Props {
  projectId: string;
  tasks: Task[];
  onEditTask: (task: Task) => void;
}

const STATUS_ORDER: TaskStatus[] = ['todo', 'in_progress', 'done'];

export function TaskList({ projectId, tasks, onEditTask }: Props) {
  const { updateTaskStatus, deleteTask } = useApp();

  const sorted = [...tasks].sort((a, b) => {
    const si = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
    if (si !== 0) return si;
    const p = ['urgent', 'high', 'medium', 'low'];
    return p.indexOf(a.priority) - p.indexOf(b.priority);
  });

  if (tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        No tasks yet. Add one above!
      </div>
    );
  }

  return (
    <div className="p-6 overflow-auto">
      <table className="w-full bg-white border border-slate-200 rounded-xl overflow-hidden">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="text-left text-xs font-semibold text-slate-500 px-4 py-3 uppercase tracking-wide">Task</th>
            <th className="text-left text-xs font-semibold text-slate-500 px-4 py-3 uppercase tracking-wide">Status</th>
            <th className="text-left text-xs font-semibold text-slate-500 px-4 py-3 uppercase tracking-wide">Priority</th>
            <th className="text-left text-xs font-semibold text-slate-500 px-4 py-3 uppercase tracking-wide">Due Date</th>
            <th className="text-left text-xs font-semibold text-slate-500 px-4 py-3 uppercase tracking-wide">Source</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((task) => (
            <tr key={task.id} className="border-b border-slate-100 hover:bg-slate-50 group cursor-pointer" onClick={() => onEditTask(task)}>
              <td className="px-4 py-3">
                <span className={`text-sm font-medium ${task.status === 'done' ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                  {task.title}
                </span>
                {task.description && <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xs">{task.description}</p>}
              </td>
              <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                <select
                  value={task.status}
                  onChange={(e) => updateTaskStatus(projectId, task.id, e.target.value as TaskStatus)}
                  className="text-xs border border-slate-200 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
                >
                  <option value="todo">To Do</option>
                  <option value="in_progress">In Progress</option>
                  <option value="done">Done</option>
                </select>
              </td>
              <td className="px-4 py-3">
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${PRIORITY_COLORS[task.priority]}`}>
                  {PRIORITY_LABELS[task.priority]}
                </span>
              </td>
              <td className="px-4 py-3">
                {task.due_date ? (
                  <span className={`text-xs ${isOverdue(task.due_date, task.status) ? 'text-red-500 font-medium' : 'text-slate-500'}`}>
                    {isOverdue(task.due_date, task.status) ? '⚠ ' : ''}{formatDate(task.due_date)}
                  </span>
                ) : (
                  <span className="text-xs text-slate-300">—</span>
                )}
              </td>
              <td className="px-4 py-3">
                <span className="text-xs text-slate-400">{task.source}</span>
              </td>
              <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => deleteTask(projectId, task.id)}
                  className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 transition-all"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

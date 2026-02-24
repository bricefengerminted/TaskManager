import { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import type { DropResult } from '@hello-pangea/dnd';
import type { Task, TaskStatus } from '@shared/types';
import { useApp } from '../../context/AppContext';
import { PRIORITY_COLORS, PRIORITY_LABELS, formatDate, isOverdue } from '../../utils';

const COLUMNS: { id: TaskStatus; label: string; color: string }[] = [
  { id: 'todo', label: 'To Do', color: 'bg-slate-100' },
  { id: 'in_progress', label: 'In Progress', color: 'bg-blue-50' },
  { id: 'done', label: 'Done', color: 'bg-green-50' },
];

interface Props {
  projectId: string;
  tasks: Task[];
  onEditTask: (task: Task) => void;
}

export function TaskBoard({ projectId, tasks, onEditTask }: Props) {
  const { reorderTasks, deleteTask } = useApp();

  // Local state so drag-and-drop updates render synchronously
  const [localTasks, setLocalTasks] = useState(tasks);
  useEffect(() => { setLocalTasks(tasks); }, [tasks]);

  // Build column task lists sorted by position
  const getColumnTasks = (status: TaskStatus) =>
    localTasks.filter(t => t.status === status).sort((a, b) => a.position - b.position);

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;

    const srcStatus = result.source.droppableId as TaskStatus;
    const dstStatus = result.destination.droppableId as TaskStatus;
    const srcIndex = result.source.index;
    const dstIndex = result.destination.index;

    // No movement
    if (srcStatus === dstStatus && srcIndex === dstIndex) return;

    const srcCol = [...getColumnTasks(srcStatus)];
    const [moved] = srcCol.splice(srcIndex, 1);

    const affectedColumns: Record<string, string[]> = {};

    if (srcStatus === dstStatus) {
      // Same column reorder
      srcCol.splice(dstIndex, 0, moved);
      affectedColumns[srcStatus] = srcCol.map(t => t.id);
    } else {
      // Cross-column move
      const dstCol = [...getColumnTasks(dstStatus)];
      dstCol.splice(dstIndex, 0, moved);
      affectedColumns[srcStatus] = srcCol.map(t => t.id);
      affectedColumns[dstStatus] = dstCol.map(t => t.id);
    }

    // Build optimistic tasks array with updated positions and statuses
    const optimistic = localTasks.map(t => {
      for (const [status, ids] of Object.entries(affectedColumns)) {
        const pos = ids.indexOf(t.id);
        if (pos !== -1) {
          return { ...t, status: status as TaskStatus, position: pos };
        }
      }
      return t;
    });

    // Update local state synchronously (critical for the dnd library)
    setLocalTasks(optimistic);
    // Persist to backend (fire and forget, context will sync state back)
    reorderTasks(projectId, affectedColumns, optimistic);
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex gap-4 p-6 h-full min-w-fit">
        {COLUMNS.map((col) => {
          const colTasks = getColumnTasks(col.id);
          return (
            <div key={col.id} className="flex flex-col w-72 flex-shrink-0">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm text-slate-700">{col.label}</h3>
                <span className="text-xs text-slate-400 bg-slate-100 rounded-full px-2 py-0.5">{colTasks.length}</span>
              </div>

              <Droppable droppableId={col.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`flex-1 rounded-lg p-2 min-h-[200px] transition-colors ${snapshot.isDraggingOver ? 'bg-indigo-50 border-2 border-dashed border-indigo-200' : col.color}`}
                  >
                    {colTasks.map((task, index) => (
                      <Draggable key={task.id} draggableId={task.id} index={index}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className={`bg-white rounded-lg border p-3 mb-2 cursor-pointer group transition-shadow ${snapshot.isDragging ? 'shadow-lg border-indigo-300' : 'border-slate-200 hover:shadow-sm hover:border-slate-300'}`}
                            onClick={() => onEditTask(task)}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-medium text-slate-800 flex-1 leading-snug">{task.title}</p>
                              <button
                                onClick={(e) => { e.stopPropagation(); deleteTask(projectId, task.id); }}
                                className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 transition-all flex-shrink-0"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>

                            {task.images && task.images.length > 0 && (
                              <div className="flex gap-1 mt-2 overflow-hidden">
                                {task.images.slice(0, 3).map((url, i) => (
                                  <img key={i} src={url} alt="" className="w-12 h-12 object-cover rounded border border-slate-200" />
                                ))}
                                {task.images.length > 3 && (
                                  <div className="w-12 h-12 rounded border border-slate-200 bg-slate-100 flex items-center justify-center text-xs text-slate-500">
                                    +{task.images.length - 3}
                                  </div>
                                )}
                              </div>
                            )}

                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${PRIORITY_COLORS[task.priority]}`}>
                                {PRIORITY_LABELS[task.priority]}
                              </span>

                              {task.source === 'slack' && (
                                <span className="text-xs text-slate-400">#slack</span>
                              )}

                              {task.due_date && (
                                <span className={`text-xs ml-auto ${isOverdue(task.due_date, task.status) ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
                                  {isOverdue(task.due_date, task.status) ? 'Overdue · ' : ''}{formatDate(task.due_date)}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}

                    {colTasks.length === 0 && (
                      <div className="flex items-center justify-center h-20 text-xs text-slate-400">
                        Drop tasks here
                      </div>
                    )}
                  </div>
                )}
              </Droppable>
            </div>
          );
        })}
      </div>
    </DragDropContext>
  );
}

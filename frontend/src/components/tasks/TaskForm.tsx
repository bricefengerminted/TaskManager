import { useState, useEffect, useRef } from 'react';
import type { Task, TaskStatus, TaskPriority } from '@shared/types';
import { useApp } from '../../context/AppContext';
import { api } from '../../api/client';
import { Lightbox } from '../Lightbox';


interface Props {
  projectId?: string;
  task: Task | null;
  onClose: () => void;
}

const GENERAL_PROJECT_ID = 'general';

export function TaskForm({ projectId, task, onClose }: Props) {
  const { state, createTask, updateTask, deleteTask, loadProjects } = useApp();
  const isEdit = Boolean(task);

  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? task?.project_id ?? GENERAL_PROJECT_ID);
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'todo');
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'medium');
  const [dueDate, setDueDate] = useState(task?.due_date ?? '');
  const [images, setImages] = useState<string[]>(task?.images ?? []);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [descFocused, setDescFocused] = useState(false);
  const descTextareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.projects.length === 0) {
      loadProjects();
    }
  }, [state.projects.length, loadProjects]);

  const projects = state.projects;

  const handleFiles = async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    setUploading(true);
    setError('');
    try {
      const { urls } = await api.uploadImages(imageFiles);
      setImages(prev => [...prev, ...urls]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError('Title is required'); return; }
    setSaving(true);
    setError('');
    try {
      const targetProjectId = selectedProjectId;
      if (isEdit && task) {
        await updateTask(task.project_id, task.id, { title, description, status, priority, due_date: dueDate || null, images });
      } else {
        await createTask(targetProjectId, { title, description, status, priority, due_date: dueDate || null });
        // If images were uploaded during creation, update the task right after
        // (createTask returns the task, but CreateTaskInput doesn't include images)
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // For new tasks: create first, then attach images via update
  const handleSubmitWithImages = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError('Title is required'); return; }
    setSaving(true);
    setError('');
    try {
      const targetProjectId = selectedProjectId;
      if (isEdit && task) {
        await updateTask(task.project_id, task.id, { title, description, status, priority, due_date: dueDate || null, images });
      } else {
        const created = await createTask(targetProjectId, { title, description, status, priority, due_date: dueDate || null });
        if (images.length > 0) {
          await updateTask(targetProjectId, created.id, { images });
        }
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (descFocused && descTextareaRef.current) {
      descTextareaRef.current.focus();
      const len = descTextareaRef.current.value.length;
      descTextareaRef.current.setSelectionRange(len, len);
    }
  }, [descFocused]);

  const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;
  const renderDescriptionWithLinks = (text: string) => {
    const parts = text.split(urlRegex);
    return parts.map((part, i) => {
      if (urlRegex.test(part)) {
        urlRegex.lastIndex = 0;
        return (
          <span key={i}>
            {part}
            <a
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center align-baseline ml-0.5 text-indigo-500 hover:text-indigo-700"
              title={part}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </span>
        );
      }
      urlRegex.lastIndex = 0;
      return <span key={i}>{part}</span>;
    });
  };

  const handleDelete = async () => {
    if (!task || !confirm('Delete this task?')) return;
    await deleteTask(task.project_id, task.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h3 className="font-semibold text-slate-800">{isEdit ? 'Edit Task' : 'New Task'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmitWithImages} className="p-6 space-y-4 overflow-y-auto">
          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

          {/* Project selector */}
          {!isEdit && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Project</label>
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            {descFocused ? (
              <textarea
                ref={descTextareaRef}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => setDescFocused(false)}
                rows={6}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              />
            ) : (
              <div
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('a')) return;
                  setDescFocused(true);
                }}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm min-h-[144px] cursor-text whitespace-pre-wrap break-words hover:border-slate-400 transition-colors"
              >
                {description ? renderDescriptionWithLinks(description) : (
                  <span className="text-slate-400">Click to add a description...</span>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="done">Done</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Image upload area */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Photos</label>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                dragOver
                  ? 'border-indigo-400 bg-indigo-50'
                  : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
              />
              {uploading ? (
                <p className="text-sm text-indigo-600">Uploading...</p>
              ) : (
                <div>
                  <svg className="w-8 h-8 mx-auto text-slate-400 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="text-sm text-slate-500">Drop photos here or click to browse</p>
                </div>
              )}
            </div>

            {/* Image thumbnails */}
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {images.map((url, i) => (
                  <div key={i} className="relative group">
                    <img
                      src={url}
                      alt=""
                      className="w-16 h-16 object-cover rounded-lg border border-slate-200 cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={(e) => { e.stopPropagation(); setLightboxIndex(i); }}
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}

            {lightboxIndex !== null && (
              <Lightbox images={images} startIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />
            )}
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="flex gap-2">
              <button type="submit" disabled={saving || uploading} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
                {saving ? 'Saving...' : isEdit ? 'Save' : 'Create Task'}
              </button>
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">
                Cancel
              </button>
            </div>
            {isEdit && (
              <button type="button" onClick={handleDelete} className="text-sm text-red-500 hover:text-red-700">
                Delete
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

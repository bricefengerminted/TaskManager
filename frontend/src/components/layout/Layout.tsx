import { useState, useEffect, useCallback } from 'react';
import { Outlet, useSearchParams } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useApp } from '../../context/AppContext';
import { TaskForm } from '../tasks/TaskForm';

export function Layout() {
  const { state, clearError } = useApp();
  const [showGlobalTaskForm, setShowGlobalTaskForm] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Open new-task modal via URL param: ?action=new-task
  useEffect(() => {
    if (searchParams.get('action') === 'new-task') {
      setShowGlobalTaskForm(true);
      searchParams.delete('action');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Expose global function for AppleScript `execute javascript` to call
  useEffect(() => {
    (window as any).__openNewTask = () => setShowGlobalTaskForm(true);
    return () => { delete (window as any).__openNewTask; };
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ctrl+N or Cmd+N to open global task creation
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault();
      setShowGlobalTaskForm(true);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        {state.error && (
          <div className="m-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-center justify-between text-sm">
            <span>{state.error}</span>
            <button onClick={clearError} className="ml-4 text-red-500 hover:text-red-700 font-bold">&times;</button>
          </div>
        )}
        <Outlet />
      </main>

      {/* Global task creation modal (Ctrl+N / Cmd+N) */}
      {showGlobalTaskForm && (
        <TaskForm
          task={null}
          onClose={() => setShowGlobalTaskForm(false)}
        />
      )}
    </div>
  );
}

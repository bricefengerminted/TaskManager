import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useApp } from '../../context/AppContext';

export function Layout() {
  const { state, clearError } = useApp();

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        {state.error && (
          <div className="m-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-center justify-between text-sm">
            <span>{state.error}</span>
            <button onClick={clearError} className="ml-4 text-red-500 hover:text-red-700 font-bold">×</button>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}

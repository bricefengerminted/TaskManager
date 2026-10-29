import { useEffect, useState } from 'react';
import type { DocHealthProject, DocKey, DocRowResult, Project, ProjectDocsInput } from '@shared/types';
import { api } from '../../api/client';

// Hub is done once it has a link; it has no task to tick or waive.
const LINK_ONLY: DocKey[] = ['hub'];

/** Inline editor for one Docs-panel row: link, status (done / not required) and due date. */
export function DocRowEditor({ project, row, onSaved, updateProject, onClose }: {
  project: Project;
  row: DocRowResult;
  onSaved: (health: DocHealthProject) => void;
  updateProject: (data: ProjectDocsInput) => Promise<boolean>;
  onClose: () => void;
}) {
  const [link, setLink] = useState(row.link ?? '');
  const [due, setDue] = useState(row.due ?? '');
  const [reason, setReason] = useState('');
  const [waiving, setWaiving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Show what was saved once the row comes back from the server.
  useEffect(() => { setLink(row.link ?? ''); }, [row.link]);
  useEffect(() => { setDue(row.due ?? ''); }, [row.due]);

  const linkOnly = LINK_ONLY.includes(row.key);
  const waivers = project.waivers ?? {};
  const projectWaiver = waivers[row.key];
  const pinned = row.due_rule === 'Pinned';

  const save = async (data: { link?: string | null; done?: boolean; due_date?: string | null }) => {
    setError('');
    setSaving(true);
    try {
      onSaved(await api.updateDocRow({ project_id: project.id, doc_key: row.key, ...data }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const setWaiver = async (next: string | null) => {
    const rest = { ...waivers };
    delete rest[row.key];
    setSaving(true);
    const ok = await updateProject({ waivers: next ? { ...rest, [row.key]: next } : rest });
    setSaving(false);
    if (ok) { setWaiving(false); setReason(''); }
  };

  const btn = 'px-2.5 py-1 rounded border text-xs disabled:opacity-50';
  const quiet = `${btn} border-slate-200 text-slate-600 hover:bg-slate-50`;

  return (
    <div className="flex flex-col gap-2 py-2 text-sm">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); save({ link: link.trim() || null }); }}
      >
        <label htmlFor={`doc-link-${row.key}`} className="text-slate-500 w-16">Link</label>
        <input
          id={`doc-link-${row.key}`}
          type="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://minted.atlassian.net/wiki/…"
          className="flex-1 max-w-xl border border-slate-200 rounded px-2 py-1"
        />
        <button type="submit" disabled={saving || link.trim() === (row.link ?? '')} className={`${btn} bg-slate-800 text-white border-slate-800`}>
          Save link
        </button>
      </form>

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); if (due) save({ due_date: due }); }}
      >
        <label htmlFor={`doc-due-${row.key}`} className="text-slate-500 w-16">Due</label>
        <input id={`doc-due-${row.key}`} type="date" value={due} onChange={(e) => setDue(e.target.value)} className="border border-slate-200 rounded px-2 py-1" />
        <button type="submit" disabled={saving || !due || due === row.due} className={quiet}>Pin date</button>
        {pinned && (
          <button type="button" disabled={saving} onClick={() => save({ due_date: null })} className={quiet}>
            Back to rule
          </button>
        )}
      </form>

      {!linkOnly && (
        <div className="flex items-center gap-2">
          <span className="text-slate-500 w-16">Status</span>
          {row.status === 'done' ? (
            <button type="button" disabled={saving} onClick={() => save({ done: false })} className={quiet}>Reopen</button>
          ) : (
            <button
              type="button"
              disabled={saving || !row.link}
              title={row.link ? undefined : 'Add a link first'}
              onClick={() => save({ done: true })}
              className={quiet}
            >
              Mark done
            </button>
          )}
          {projectWaiver ? (
            <>
              <span className="text-slate-400">Not required: {projectWaiver}</span>
              <button type="button" disabled={saving} onClick={() => setWaiver(null)} className={quiet}>Required again</button>
            </>
          ) : row.status === 'waived' ? (
            <span className="text-slate-400">Not required for this project's stage or doc mode</span>
          ) : waiving ? (
            <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) setWaiver(reason.trim()); }}>
              <input
                autoFocus
                aria-label="Why it isn't needed"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why it isn't needed"
                className="w-64 border border-slate-200 rounded px-2 py-1"
              />
              <button type="submit" disabled={saving || !reason.trim()} className={quiet}>Save</button>
              <button type="button" onClick={() => setWaiving(false)} className={quiet}>Cancel</button>
            </form>
          ) : (
            <button type="button" disabled={saving} onClick={() => setWaiving(true)} className={quiet}>Not required</button>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        {error && <span className="text-red-600">{error}</span>}
        <button type="button" onClick={onClose} className="ml-auto text-xs text-slate-500 hover:underline">Close</button>
      </div>
    </div>
  );
}

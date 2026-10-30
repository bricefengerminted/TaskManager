import { Fragment, useEffect, useRef, useState } from 'react';
import type { Decision, DocHealthProject, Project, ProjectDocsInput } from '@shared/types';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { formatDate, halfLabel, safeHttpUrl } from '../../utils';
import { DocStatusChip, FlagChips } from './DocStatusChip';
import { DocRowEditor } from './DocRowEditor';

const DECISION_LABELS: Record<Decision, string> = { go: 'Go', no_go: 'No-go', parked: 'Parked' };

export function DocsPanel({ project, refreshKey = '' }: { project: Project; refreshKey?: string }) {
  const { updateProjectDocs, loadTasks, loadProject } = useApp();
  const [health, setHealth] = useState<DocHealthProject | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Decision | null>(null);
  const [reason, setReason] = useState('');
  const [revisit, setRevisit] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  // Bumped on every load and every row save, so a slower, older load can't overwrite newer rows.
  const seq = useRef(0);

  const tracked = project.docs_stage === 'proposal' || project.docs_stage === 'roadmap';

  useEffect(() => {
    let alive = true;
    setError('');
    if (!tracked) {
      setHealth(null);
      return;
    }
    setLoading(true);
    const mine = ++seq.current;
    api
      .getDocHealth({ project_id: project.id })
      .then((res) => { if (alive && mine === seq.current) setHealth(res.projects[0] ?? null); })
      .catch((e) => { if (alive) setError((e as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [project, tracked, refreshKey]);

  const update = async (data: ProjectDocsInput): Promise<boolean> => {
    setError('');
    setSaving(true);
    try {
      await updateProjectDocs(project.id, data);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const rowSaved = (h: DocHealthProject) => {
    seq.current++;
    setHealth(h);
    // The row's task and the project's hub link may have changed; refresh the board and header.
    void loadTasks(project.id);
    void loadProject(project.id);
  };

  const openForm = (d: Decision) => {
    setForm(d);
    setReason('');
    setRevisit('');
    setError('');
  };

  const submitDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const ok = await update({
      decision: form,
      decision_reason: reason.trim(),
      revisit_by: form === 'parked' ? revisit : undefined,
    });
    if (ok) setForm(null);
  };

  if (!project.docs_stage) {
    return (
      <div className="bg-white border-b border-slate-200 px-8 py-2 text-sm text-slate-500 flex items-center gap-3">
        <span>Not tracked by the doc system.</span>
        <button
          type="button"
          disabled={saving}
          onClick={() => update({ docs_stage: 'proposal' })}
          className="text-indigo-600 hover:underline disabled:opacity-50"
        >
          Track as proposal
        </button>
        {error && <span className="text-red-600">{error}</span>}
      </div>
    );
  }

  if (project.docs_stage === 'not_pursued') {
    return (
      <div className="bg-white border-b border-slate-200 px-8 py-2 text-sm text-slate-500">
        Not pursued{project.decision_date ? ` (${formatDate(project.decision_date)})` : ''}
        {project.decision_reason ? `: ${project.decision_reason}` : ''}
      </div>
    );
  }

  const hubUrl = safeHttpUrl(project.hub_url);

  return (
    <div className="bg-white border-b border-slate-200 px-8 py-3">
      <div className="flex items-center gap-3 text-sm">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="font-semibold text-slate-700 flex items-center gap-1"
        >
          <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          Docs
        </button>
        {project.docs_stage === 'roadmap' ? (
          <span className="text-slate-500">
            {health ? `${halfLabel(health.half)} · ${project.team ?? '-'} · ${health.roadmap_stage ?? '-'}` : loading ? 'Loading…' : '-'}
          </span>
        ) : (
          <span className="text-slate-500">
            Proposal{project.decision ? ` · ${DECISION_LABELS[project.decision]}` : ''}
            {project.revisit_by ? ` · revisit ${formatDate(project.revisit_by)}` : ''}
          </span>
        )}
        {project.hub_url && (hubUrl ? (
          <a href={hubUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">Hub</a>
        ) : (
          <span className="text-slate-500">Hub</span>
        ))}
        {health && <FlagChips flags={health.flags} />}
        {project.docs_stage === 'roadmap' && (
          <label className="ml-auto flex items-center gap-1.5 text-slate-500">
            <input
              type="checkbox"
              disabled={saving}
              checked={project.doc_mode === 'one_pager_only'}
              onChange={(e) => update({ doc_mode: e.target.checked ? 'one_pager_only' : 'full' })}
            />
            One-pager only
          </label>
        )}
        {project.docs_stage === 'proposal' && (
          <div className="ml-auto flex gap-1">
            {(['go', 'no_go', 'parked'] as Decision[]).map((d) => (
              <button
                key={d}
                type="button"
                disabled={saving}
                aria-pressed={project.decision === d}
                onClick={() => openForm(d)}
                className={`px-2.5 py-1 rounded border text-xs disabled:opacity-50 ${project.decision === d ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                {DECISION_LABELS[d]}
              </button>
            ))}
          </div>
        )}
      </div>
      {form && (
        <form onSubmit={submitDecision} className="mt-2 flex flex-col gap-2 max-w-xl text-sm">
          <label className="flex flex-col gap-1 text-slate-600">
            Reason for "{DECISION_LABELS[form]}"
            <textarea
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="border border-slate-200 rounded px-2 py-1"
            />
          </label>
          {form === 'parked' && (
            <label className="flex flex-col gap-1 text-slate-600">
              Revisit by
              <input
                type="date"
                required
                value={revisit}
                onChange={(e) => setRevisit(e.target.value)}
                className="border border-slate-200 rounded px-2 py-1 w-44"
              />
            </label>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={saving || !reason.trim()} className="px-3 py-1 rounded bg-slate-800 text-white text-xs disabled:opacity-50">
              Save
            </button>
            <button type="button" onClick={() => setForm(null)} className="px-3 py-1 rounded border border-slate-200 text-xs text-slate-600">
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
      {open && health && (
        <table className="mt-2 w-full text-sm">
          <thead className="sr-only">
            <tr><th>Doc</th><th>Due</th><th>Rule</th><th>Status</th><th>Edit</th></tr>
          </thead>
          <tbody>
            {health.rows.map((r) => {
              const link = safeHttpUrl(r.link);
              return (
                <Fragment key={r.key}>
                <tr className="border-t border-slate-100">
                  <td className="py-1.5 pr-4 text-slate-700">
                    {link ? <a href={link} target="_blank" rel="noreferrer" className="hover:underline">{r.label}</a> : r.label}
                  </td>
                  <td className="py-1.5 pr-4 text-slate-500 whitespace-nowrap">{r.due ? formatDate(r.due) : '-'}</td>
                  <td className="py-1.5 pr-4 text-slate-400 whitespace-nowrap">
                    {r.status === 'cant_date' && r.needs.length ? `needs: ${r.needs.join(' or ')}` : r.due_rule}
                  </td>
                  <td className="py-1.5"><DocStatusChip status={r.status} /></td>
                  <td className="py-1.5 text-right">
                    <button
                      type="button"
                      aria-expanded={editing === r.key}
                      aria-label={`Edit ${r.label}`}
                      onClick={() => setEditing(editing === r.key ? null : r.key)}
                      className="text-xs text-slate-400 hover:text-indigo-600"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
                {editing === r.key && (
                  <tr>
                    <td colSpan={5} className="pl-4 bg-slate-50">
                      <DocRowEditor
                        project={project}
                        row={r}
                        onSaved={rowSaved}
                        updateProject={update}
                        onClose={() => setEditing(null)}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

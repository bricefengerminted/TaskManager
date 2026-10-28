import { useCallback, useEffect, useState } from 'react';
import type { Decision, DocHealthProject, Project, ProjectDocsInput } from '@shared/types';
import { api } from '../../api/client';
import { formatDate, halfLabel } from '../../utils';
import { DocStatusChip, FlagChips } from './DocStatusChip';

const DECISION_LABELS: Record<Decision, string> = { go: 'Go', no_go: 'No-go', parked: 'Parked' };

export function DocsPanel({ project }: { project: Project }) {
  const [current, setCurrent] = useState<Project>(project);
  const [health, setHealth] = useState<DocHealthProject | null>(null);
  const [open, setOpen] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => setCurrent(project), [project]);

  const load = useCallback(async (p: Project) => {
    if (p.docs_stage !== 'proposal' && p.docs_stage !== 'roadmap') {
      setHealth(null);
      return;
    }
    const res = await api.getDocHealth({ project_id: p.id });
    setHealth(res.projects[0] ?? null);
  }, []);

  useEffect(() => {
    load(current).catch((e) => setError((e as Error).message));
  }, [current, load]);

  const update = async (data: ProjectDocsInput) => {
    setError('');
    try {
      setCurrent(await api.updateProjectDocs(current.id, data));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const decide = async (decision: Decision) => {
    const reason = window.prompt(`Reason for "${DECISION_LABELS[decision]}"?`)?.trim();
    if (!reason) return;
    let revisit_by: string | undefined;
    if (decision === 'parked') {
      revisit_by = window.prompt('Revisit by (YYYY-MM-DD)?')?.trim();
      if (!revisit_by || !/^\d{4}-\d{2}-\d{2}$/.test(revisit_by)) {
        setError('Revisit date must be YYYY-MM-DD');
        return;
      }
    }
    await update({ decision, decision_reason: reason, revisit_by });
  };

  if (!current.docs_stage) {
    return (
      <div className="bg-white border-b border-slate-200 px-8 py-2 text-sm text-slate-500 flex items-center gap-3">
        <span>Not tracked by the doc system.</span>
        <button onClick={() => update({ docs_stage: 'proposal' })} className="text-indigo-600 hover:underline">
          Track as proposal
        </button>
        {error && <span className="text-red-600">{error}</span>}
      </div>
    );
  }

  if (current.docs_stage === 'not_pursued') {
    return (
      <div className="bg-white border-b border-slate-200 px-8 py-2 text-sm text-slate-500">
        Not pursued{current.decision_date ? ` (${formatDate(current.decision_date)})` : ''}: {current.decision_reason}
      </div>
    );
  }

  return (
    <div className="bg-white border-b border-slate-200 px-8 py-3">
      <div className="flex items-center gap-3 text-sm">
        <button onClick={() => setOpen(!open)} className="font-semibold text-slate-700 flex items-center gap-1">
          <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          Docs
        </button>
        {current.docs_stage === 'roadmap' ? (
          <span className="text-slate-500">
            {halfLabel(health?.half)} · {current.team ?? '—'} · {health?.roadmap_stage ?? '—'}
          </span>
        ) : (
          <span className="text-slate-500">
            Proposal{current.decision ? ` · ${DECISION_LABELS[current.decision]}` : ''}
            {current.revisit_by ? ` · revisit ${formatDate(current.revisit_by)}` : ''}
          </span>
        )}
        {current.hub_url && (
          <a href={current.hub_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">Hub</a>
        )}
        {health && <FlagChips flags={health.flags} />}
        {current.docs_stage === 'roadmap' && (
          <label className="ml-auto flex items-center gap-1.5 text-slate-500">
            <input
              type="checkbox"
              checked={current.doc_mode === 'one_pager_only'}
              onChange={(e) => update({ doc_mode: e.target.checked ? 'one_pager_only' : 'full' })}
            />
            One-pager only
          </label>
        )}
        {current.docs_stage === 'proposal' && (
          <div className="ml-auto flex gap-1">
            {(['go', 'no_go', 'parked'] as Decision[]).map((d) => (
              <button
                key={d}
                onClick={() => decide(d)}
                className={`px-2.5 py-1 rounded border text-xs ${current.decision === d ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                {DECISION_LABELS[d]}
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
      {open && health && (
        <table className="mt-2 w-full text-sm">
          <tbody>
            {health.rows.map((r) => (
              <tr key={r.key} className="border-t border-slate-100">
                <td className="py-1.5 pr-4 text-slate-700">
                  {r.link ? <a href={r.link} target="_blank" rel="noreferrer" className="hover:underline">{r.label}</a> : r.label}
                </td>
                <td className="py-1.5 pr-4 text-slate-500 whitespace-nowrap">{r.due ? formatDate(r.due) : '—'}</td>
                <td className="py-1.5 pr-4 text-slate-400 whitespace-nowrap">
                  {r.status === 'cant_date' && r.needs.length ? `needs: ${r.needs.join(' or ')}` : r.due_rule}
                </td>
                <td className="py-1.5"><DocStatusChip status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

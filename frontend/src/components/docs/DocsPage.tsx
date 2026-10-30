import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DocHealthProject, DocHealthResponse, DocKey, DocStatus } from '@shared/types';
import { DOC_MATRIX, TEAMS } from '@shared/doc-matrix';
import { api } from '../../api/client';
import { formatDate, halfLabel, safeHttpUrl } from '../../utils';
import { DOC_STATUS_META, DocStatusChip, FlagChips } from './DocStatusChip';

const HALF_RE = /^\d{4}-H[12]$/;
const STATUS_FILTERS: DocStatus[] = ['overdue', 'due_soon', 'missing', 'cant_date', 'draft', 'review'];
const COLUMN_LABELS: Record<DocKey, string> = {
  hub: 'Hub', one_pager: '1-pager', research: 'Research', prd: 'PRD', figma: 'Figma',
  'experiment_brief.plan': 'Exp plan', jira_epic: 'Epic', cs_marketing_brief: 'CS/Mkt',
  release_notes: 'Rel notes', 'experiment_brief.results': 'Exp results',
};

type Group = { key: string; label: string; teams: [string, DocHealthProject[]][] };

function groupProjects(projects: DocHealthProject[]): Group[] {
  const groups = new Map<string, Map<string, DocHealthProject[]>>();
  for (const p of projects) {
    const key = p.docs_stage === 'proposal' ? 'zz-proposals' : p.half && HALF_RE.test(p.half) ? p.half : 'zy-unscheduled';
    const teams = groups.get(key) ?? new Map<string, DocHealthProject[]>();
    const team = p.team ?? '-';
    teams.set(team, [...(teams.get(team) ?? []), p]);
    groups.set(key, teams);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, teams]) => ({
      key,
      label: key === 'zz-proposals' ? 'Proposals' : halfLabel(key),
      teams: [...teams.entries()].sort(([a], [b]) => a.localeCompare(b)),
    }));
}

export function DocsPage() {
  const [data, setData] = useState<DocHealthResponse | null>(null);
  const [team, setTeam] = useState('');
  const [status, setStatus] = useState('');
  const [half, setHalf] = useState('');
  const [halves, setHalves] = useState<string[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setError('');
    api
      .getDocHealth({ team, status, half })
      .then((res) => {
        if (!alive) return;
        setData(res);
        const seen = res.projects.map((p) => p.half).filter((h): h is string => !!h && HALF_RE.test(h));
        setHalves((prev) => [...new Set([...prev, ...seen])].sort());
      })
      .catch((e) => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
  }, [team, status, half]);

  const groups = useMemo(() => groupProjects(data?.projects ?? []), [data]);

  return (
    <div className="p-8">
      <div className="flex items-center gap-4 mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Docs</h2>
        <select aria-label="Filter by team" value={team} onChange={(e) => setTeam(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1 text-sm">
          <option value="">All teams</option>
          {TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select aria-label="Filter by half" value={half} onChange={(e) => setHalf(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1 text-sm">
          <option value="">All halves</option>
          {halves.map((h) => <option key={h} value={h}>{halfLabel(h)}</option>)}
        </select>
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1 text-sm">
          <option value="">Any status</option>
          {STATUS_FILTERS.map((s) => <option key={s} value={s}>{DOC_STATUS_META[s].icon} {DOC_STATUS_META[s].label}</option>)}
        </select>
        {data && (
          <span className="ml-auto text-sm text-slate-500 flex gap-3">
            {STATUS_FILTERS.map((s) => <span key={s}><span aria-hidden="true">{DOC_STATUS_META[s].icon}</span><span className="sr-only">{DOC_STATUS_META[s].label}</span> {data.summary[s]}</span>)}
          </span>
        )}
      </div>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
      {data && data.projects.length === 0 && <p className="text-slate-500">No tracked projects match.</p>}

      {groups.map((g) => (
        <section key={g.key} className="mb-8">
          <h3 className="font-semibold text-slate-700 mb-2">{g.label}</h3>
          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-slate-200">
                  <th className="text-left font-medium px-4 py-2 w-72">Project</th>
                  {DOC_MATRIX.map((r) => (
                    <th key={r.key} className="font-medium px-2 py-2 whitespace-nowrap">{COLUMN_LABELS[r.key] ?? r.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.teams.map(([teamName, projects]) => (
                  <TeamRows key={teamName} team={teamName} projects={projects} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function TeamRows({ team, projects }: { team: string; projects: DocHealthProject[] }) {
  return (
    <>
      <tr className="bg-slate-50">
        <td colSpan={DOC_MATRIX.length + 1} className="px-4 py-1 text-xs font-semibold text-slate-500">{team}</td>
      </tr>
      {projects.map((p) => (
        <tr key={p.project_id} className="border-t border-slate-100">
          <td className="px-4 py-2">
            <Link to={`/projects/${p.project_id}`} className="text-slate-800 hover:text-indigo-600">{p.name}</Link>
            <div className="mt-0.5"><FlagChips flags={p.flags} /></div>
          </td>
          {DOC_MATRIX.map((col) => {
            const row = p.rows.find((r) => r.key === col.key);
            const link = row ? safeHttpUrl(row.link) : null;
            const chip = row && (
              <DocStatusChip
                compact
                status={row.status}
                title={`${row.label}: ${DOC_STATUS_META[row.status].label}${row.due ? ` · due ${formatDate(row.due)}` : ''} (${row.status === 'cant_date' && row.needs.length ? `needs: ${row.needs.join(' or ')}` : row.due_rule})`}
              />
            );
            return (
              <td key={col.key} className="px-2 py-2 text-center">
                {chip && (link
                  ? <a href={link} target="_blank" rel="noreferrer">{chip}</a>
                  : <Link to={`/projects/${p.project_id}`}>{chip}</Link>)}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

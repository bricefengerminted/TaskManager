// Roll-up grids (root, year, half, team, Proposals, Not Pursued, Unscheduled) and the hub
// settings section. Spec §3 "Roll-ups"; step-4 plan D4.

import { DOC_MATRIX, type DocKey, type DocStatus } from './doc-matrix';
import { em, link, p, table, text, type AdfNode } from './confluence-adf';
import { STATUS_LABEL, type HubSettings } from './confluence-hub';

export interface RollupRow {
  name: string;
  hubUrl: string | null;
  stage: string | null;
  cells: Partial<Record<DocKey, DocStatus>>;
  overdue: number;
}

export function rollupContent(rows: RollupRow[]): AdfNode[] {
  if (rows.length === 0) return [p(text('No projects here yet.'))];
  const cols = DOC_MATRIX.filter((d) => rows.some((r) => r.cells[d.key] && r.cells[d.key] !== 'inactive'));
  const sorted = [...rows].sort((a, b) => b.overdue - a.overdue || a.name.localeCompare(b.name));
  return [table(
    ['Project', 'Stage', ...cols.map((c) => c.label)],
    sorted.map((r) => [
      [r.hubUrl ? link(r.name, r.hubUrl) : text(r.name)],
      [text(r.stage ?? '-')],
      ...cols.map((c) => {
        const s = r.cells[c.key];
        return [text(s ? STATUS_LABEL[s] : '-')];
      }),
    ]),
  )];
}

export function settingsContent(s: HubSettings): AdfNode[] {
  const waivers = Object.entries(s.waivers);
  return [
    p(em('Change these in TaskManager (Docs panel) or ask Claude.')),
    table(['Setting', 'Value'], [
      [[text('doc_mode')], [text(s.doc_mode)]],
      [[text('customer-facing launch')], [text(s.customer_facing ? 'yes' : 'no')]],
      [[text('waivers')], [text(waivers.length ? waivers.map(([k, why]) => `${k}: ${why}`).join('; ') : 'none')]],
    ]),
  ];
}

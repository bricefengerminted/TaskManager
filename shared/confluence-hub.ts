// Hub and roll-up page bodies. Generated sections are rewritten by the doc check;
// everything else is hand-written and never touched after creation.
// Spec: docs/superpowers/specs/2026-10-28-project-docs-system-design.md §3

import {
  DOC_MATRIX, evaluateDocs,
  type DocContext, type DocEvidence, type DocKey, type DocRowResult, type DocStatus, type Phases, type RoadmapStage,
} from './doc-matrix';
import { bulletList, doc, em, generated, h, link, p, panel, table, text, type AdfDoc, type AdfNode } from './confluence-adf';

/** A roadmap item as returned by GET /api/roadmap (serialized roadmap_items row). */
export interface HubItem {
  id: string;
  name: string;
  team_name: string | null;
  stage: string;
  status: string | null;
  pm_name: string | null;
  jira_key: string | null;
  first_seen_at: string | null;
  phases: Phases;
  links: Record<string, string | null>;
}

export interface HubSettings {
  doc_mode: 'full' | 'one_pager_only';
  customer_facing: boolean;
  waivers: Partial<Record<DocKey, string>>;
}

export const STATUS_LABEL: Record<DocStatus, string> = {
  done: '✅ Done',
  draft: '📝 Draft',
  review: '📄 Review',
  due_soon: '⏳ Due soon',
  overdue: '🔴 Overdue',
  missing: '⚪ Missing',
  waived: '➖ Waived',
  cant_date: "❓ Can't date",
  inactive: 'Not active yet',
};

const UNKNOWN = '❓ Not in roadmap snapshot';
const PHASE_LABELS: [keyof Phases, string][] = [
  ['discovery', 'Discovery'], ['ux', 'UX'], ['uxr', 'UX Research'], ['build', 'Build'], ['measure', 'Measure'],
];

/** Default settings for a hub created before its TaskManager project exists. */
export function defaultSettings(item: Pick<HubItem, 'stage'>): HubSettings {
  return {
    doc_mode: 'full',
    customer_facing: false,
    waivers: item.stage === 'build' || item.stage === 'measure' ? { one_pager: 'predates system' } : {},
  };
}

/** Doc rows for an item that has no TaskManager project yet, from roadmap data alone. */
/** `hubUrl`: the item's hub page, when one exists, so the Hub row reads Done. */
export function itemDocRows(item: HubItem, today: string, settings: HubSettings = defaultSettings(item), hubUrl?: string): DocRowResult[] {
  const c: DocContext = {
    stage: item.stage as RoadmapStage,
    phases: item.phases,
    entered_scope_at: item.first_seen_at,
    doc_mode: settings.doc_mode,
    customer_facing: settings.customer_facing,
    waivers: settings.waivers,
    decision: null,
  };
  const evidence: Partial<Record<DocKey, DocEvidence>> = {};
  for (const row of DOC_MATRIX) {
    evidence[row.key] = { link: row.roadmapLink ? item.links[row.roadmapLink] ?? null : null };
  }
  if (hubUrl) evidence.hub = { link: hubUrl };
  return evaluateDocs(c, evidence, today);
}

const dash = (v: string | null | undefined) => (v && v.trim() ? v : '—');

export function statusContent(item: HubItem, today: string): AdfNode[] {
  const kv = (k: string, v: string): AdfNode[][] => [[text(k)], [text(v)]];
  const phaseRows = PHASE_LABELS.map(([key, label]) => {
    const ph = item.phases[key];
    return kv(label, ph?.start || ph?.end ? `${dash(ph.start)} → ${dash(ph.end)}` : '—');
  });
  return [
    table(['Field', 'Value'], [
      kv('Stage', dash(item.stage)),
      kv('Status', dash(item.status)),
      kv('Team', dash(item.team_name)),
      kv('PM', dash(item.pm_name)),
      kv('Eng', UNKNOWN),
      kv('UX', UNKNOWN),
      kv('Jira', dash(item.jira_key)),
      ...phaseRows,
    ]),
    p(em(`From roadmap.mntd.net, updated ${today}.`)),
  ];
}

function statusText(r: DocRowResult): string {
  if (r.status === 'cant_date') return `${STATUS_LABEL.cant_date}: needs ${r.needs.join(' or ')}`;
  return r.mismatch ? `${STATUS_LABEL[r.status]} · ⚠️ Link mismatch` : STATUS_LABEL[r.status];
}

export function checklistContent(rows: DocRowResult[]): AdfNode[] {
  if (rows.length === 0) return [p(text('No docs required yet.'))];
  return [
    table(['Doc', 'Phase', 'Status', 'Due', 'Rule', 'Link'], rows.map((r) => [
      [text(r.label)],
      [text(r.phase ?? '—')],
      [text(statusText(r))],
      [text(r.due ?? '—')],
      [text(r.due_rule)],
      r.link && r.link.startsWith('https://') ? [link('Open', r.link)] : [text('—')],
    ])),
  ];
}

function settingsTable(s: HubSettings): AdfNode {
  const waivers = Object.entries(s.waivers);
  return table(['Setting', 'Value'], [
    [[text('doc_mode')], [text(s.doc_mode)]],
    [[text('customer-facing launch')], [text(s.customer_facing ? 'yes' : 'no')]],
    [[text('waivers')], [text(waivers.length ? waivers.map(([k, why]) => `${k} — ${why}`).join('; ') : 'none')]],
  ]);
}

export interface HubInput {
  item: HubItem;
  rows: DocRowResult[];
  today: string;
  settings?: HubSettings;
  offRoadmap?: boolean;
  /** Body of an adopted page (canonical draft), kept under "Background". */
  adoptedContent?: AdfNode[];
}

export function renderHubDoc(input: HubInput): AdfDoc {
  const settings = input.settings ?? defaultSettings(input.item);
  return doc([
    ...(input.offRoadmap
      ? [panel('warning', [p(text('Off-roadmap: this project is not on roadmap.mntd.net. The doc check tracks it but computes no due dates.'))])]
      : []),
    h(2, 'Status'),
    generated('status', statusContent(input.item, input.today)),
    h(2, 'Doc checklist'),
    generated('checklist', checklistContent(input.rows)),
    h(2, 'Links'),
    bulletList([[text('Slack: ')], [text('Dashboards: ')]]),
    h(2, 'Decisions log'),
    p(em('Date — decision — why.')),
    h(2, 'Open questions'),
    p(),
    h(2, 'Settings'),
    p(em('Read by the doc check. Edit the Value column only; waivers are "doc_key — reason", separated by ";".')),
    settingsTable(settings),
    ...(input.adoptedContent?.length ? [h(2, 'Background (from the original page)'), ...input.adoptedContent] : []),
  ]);
}

/** Root, half, team, Proposals and Not Pursued pages: an intro plus one generated grid. */
export function renderRollupDoc(intro: string): AdfDoc {
  return doc([p(text(intro)), generated('rollup', [p(em('Filled in by the daily doc check.'))])]);
}

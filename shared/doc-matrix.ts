// Doc matrix: which docs a project owes, when each is due, and its status.
// Pure module shared by backend and frontend. Spec:
// docs/superpowers/specs/2026-10-28-project-docs-system-design.md

export type RoadmapStage =
  | 'not-started' | 'roadmap' | 'discover' | 'plan' | 'ready-for-build'
  | 'build' | 'measure' | 'done' | 'on-hold' | 'wont-do';

export type PhaseKey = 'discovery' | 'ux' | 'uxr' | 'build' | 'measure';
export type DocPhase = 'discovery' | 'ux' | 'build' | 'measure';

export interface PhaseDates {
  start?: string | null;
  end?: string | null;
}
export type Phases = Partial<Record<PhaseKey, PhaseDates>>;

export type DocKey =
  | 'hub' | 'one_pager' | 'research' | 'prd' | 'figma' | 'experiment_brief.plan'
  | 'jira_epic' | 'cs_marketing_brief' | 'release_notes' | 'metrics_snapshot'
  | 'experiment_brief.results';

export type DocStatus =
  | 'done' | 'draft' | 'review' | 'due_soon' | 'overdue' | 'missing' | 'waived' | 'cant_date' | 'inactive';

export const DOC_STATUSES: DocStatus[] = [
  'overdue', 'due_soon', 'missing', 'cant_date', 'draft', 'review', 'done', 'waived', 'inactive',
];

export type Anchor =
  | 'entered_scope' | 'discovery.start' | 'discovery.end'
  | 'build.start' | 'build.end' | 'measure.start' | 'measure.end';

export interface DueRule {
  anchor: Anchor;
  offsetDays: number;
}

/** Roadmap link field that counts as evidence for a row. */
export type RoadmapLinkField =
  | 'prd' | 'figma' | 'jiraEpic' | 'releaseNotes' | 'hub' | 'onePager' | 'experimentBrief';

export interface DocContext {
  /** Roadmap stage; null = proposal (not on the roadmap yet). */
  stage: RoadmapStage | null;
  phases: Phases;
  /** When the item first entered scope (first roadmap sync). */
  entered_scope_at: string | null;
  doc_mode: 'full' | 'one_pager_only';
  customer_facing: boolean;
  waivers: Partial<Record<DocKey, string>>;
  decision: 'go' | 'no_go' | 'parked' | null;
}

export interface DocEvidence {
  /** Value of the roadmap link field (or project hub/one-pager URL). */
  link?: string | null;
  /** Child page of the hub found by the doc check. */
  page_url?: string | null;
  published?: boolean;
  results_filled?: boolean;
  task_done?: boolean;
}

export interface DocRow {
  key: DocKey;
  phase: DocPhase | null;
  label: string;
  /** Confluence child page title suffix: "[OI] <name> — <pageTitle>". */
  pageTitle: string;
  required: (c: DocContext) => boolean;
  due: DueRule;
  fallback?: DueRule;
  roadmapLink?: RoadmapLinkField;
  /** Done as soon as the link is set; no task completion needed. */
  linkOnly?: boolean;
  /** Done only when the page's Results section has content. */
  needsResults?: boolean;
}

export interface DocRowResult {
  key: DocKey;
  label: string;
  phase: DocPhase | null;
  due: string | null;
  due_rule: string;
  /** Readable anchors missing when status is cant_date; otherwise empty. */
  needs: string[];
  status: DocStatus;
  mismatch: boolean;
  link: string | null;
}

const onRoadmap = (c: DocContext) => c.stage !== null;
const hasPhase = (c: DocContext, p: PhaseKey) => Boolean(c.phases[p]?.start || c.phases[p]?.end);

export const DOC_MATRIX: DocRow[] = [
  { key: 'hub', phase: null, label: 'Hub', pageTitle: 'Hub', required: onRoadmap,
    due: { anchor: 'entered_scope', offsetDays: 0 }, roadmapLink: 'hub', linkOnly: true },
  { key: 'one_pager', phase: 'discovery', label: 'One-Pager', pageTitle: 'One-Pager', required: () => true,
    due: { anchor: 'discovery.start', offsetDays: 14 }, fallback: { anchor: 'entered_scope', offsetDays: 14 },
    roadmapLink: 'onePager' },
  { key: 'research', phase: 'discovery', label: 'Research Synthesis', pageTitle: 'Research Synthesis',
    required: (c) => hasPhase(c, 'uxr'),
    due: { anchor: 'discovery.end', offsetDays: 0 }, fallback: { anchor: 'build.start', offsetDays: -56 } },
  { key: 'prd', phase: 'ux', label: 'Brief/PRD', pageTitle: 'Brief/PRD',
    required: onRoadmap,
    due: { anchor: 'build.start', offsetDays: -14 }, roadmapLink: 'prd' },
  { key: 'figma', phase: 'ux', label: 'Figma', pageTitle: 'Figma', required: (c) => hasPhase(c, 'ux'),
    due: { anchor: 'build.start', offsetDays: 0 }, roadmapLink: 'figma', linkOnly: true },
  { key: 'experiment_brief.plan', phase: 'ux', label: 'Experiment Brief — Plan', pageTitle: 'Experiment Brief',
    required: (c) => hasPhase(c, 'measure'),
    due: { anchor: 'build.start', offsetDays: 0 }, roadmapLink: 'experimentBrief' },
  { key: 'jira_epic', phase: 'build', label: 'Jira Epic', pageTitle: 'Jira Epic', required: onRoadmap,
    due: { anchor: 'build.start', offsetDays: 0 }, roadmapLink: 'jiraEpic', linkOnly: true },
  { key: 'cs_marketing_brief', phase: 'build', label: 'CS/Marketing Brief', pageTitle: 'CS/Marketing Brief',
    required: (c) => onRoadmap(c) && c.customer_facing,
    due: { anchor: 'build.end', offsetDays: -7 } },
  { key: 'release_notes', phase: 'build', label: 'Release Notes', pageTitle: 'Release Notes', required: onRoadmap,
    due: { anchor: 'build.end', offsetDays: 0 }, roadmapLink: 'releaseNotes' },
  { key: 'metrics_snapshot', phase: 'measure', label: 'Metrics Snapshot', pageTitle: 'Metrics Snapshot',
    required: (c) => hasPhase(c, 'measure'),
    due: { anchor: 'measure.start', offsetDays: 14 }, fallback: { anchor: 'build.end', offsetDays: 14 } },
  { key: 'experiment_brief.results', phase: 'measure', label: 'Experiment Brief — Results', pageTitle: 'Experiment Brief',
    required: (c) => hasPhase(c, 'measure'),
    due: { anchor: 'measure.end', offsetDays: 0 }, fallback: { anchor: 'build.end', offsetDays: 42 },
    roadmapLink: 'experimentBrief', needsResults: true },
];

export const DOC_KEYS: DocKey[] = DOC_MATRIX.map((r) => r.key);

// ── dates (ISO YYYY-MM-DD, UTC) ────────────────────────────────────

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

// ── rules ──────────────────────────────────────────────────────────

const ANCHOR_LABEL: Record<Anchor, string> = {
  entered_scope: 'Entered roadmap',
  'discovery.start': 'Discovery start',
  'discovery.end': 'Discovery end',
  'build.start': 'Build start',
  'build.end': 'Build end',
  'measure.start': 'Measure start',
  'measure.end': 'Measure end',
};

export function describeRule(rule: DueRule): string {
  if (rule.offsetDays === 0) return ANCHOR_LABEL[rule.anchor];
  const sign = rule.offsetDays > 0 ? '+' : '−';
  const abs = Math.abs(rule.offsetDays);
  const amount = abs % 7 === 0 ? `${abs / 7}w` : `${abs}d`;
  return `${ANCHOR_LABEL[rule.anchor]} ${sign}${amount}`;
}

/** True for a real calendar date written YYYY-MM-DD (rejects 2026-02-31). */
export function isValidIsoDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && addDays(v, 0) === v;
}

function validDate(v: string | null | undefined): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const d = v.slice(0, 10);
  try {
    return addDays(d, 0) === d ? d : null;
  } catch {
    return null;
  }
}

function anchorDate(c: DocContext, anchor: Anchor): string | null {
  if (anchor === 'entered_scope') return validDate(c.entered_scope_at);
  const [phase, edge] = anchor.split('.') as [PhaseKey, 'start' | 'end'];
  return validDate(c.phases[phase]?.[edge]);
}

export function computeDue(row: DocRow, c: DocContext): { due: string | null; rule: DueRule } {
  const primary = anchorDate(c, row.due.anchor);
  if (primary) return { due: addDays(primary, row.due.offsetDays), rule: row.due };
  if (row.fallback) {
    const fb = anchorDate(c, row.fallback.anchor);
    if (fb) return { due: addDays(fb, row.fallback.offsetDays), rule: row.fallback };
  }
  return { due: null, rule: row.due };
}

// on-hold / wont-do are never actually used: isStopped() returns first in isActive's callers
// (rowStatus waives before activity is checked). Entries exist only to satisfy the Record type.
const STAGE_PHASE_INDEX: Record<RoadmapStage, number> = {
  'not-started': 0, roadmap: 0, discover: 0, plan: 1, 'ready-for-build': 1,
  build: 2, measure: 3, done: 3, 'on-hold': 0, 'wont-do': 0,
};
const PHASE_INDEX: Record<DocPhase, number> = { discovery: 0, ux: 1, build: 2, measure: 3 };

/** Parked deliberately stays a proposal-like state: it is not treated as stopped. */
export function isStopped(c: DocContext): boolean {
  return c.decision === 'no_go' || c.stage === 'on-hold' || c.stage === 'wont-do';
}

export function isActive(row: DocRow, c: DocContext, due: string | null, today: string): boolean {
  if (row.phase === null) return true;
  if (c.stage === null) return row.key === 'one_pager';
  if (STAGE_PHASE_INDEX[c.stage] >= PHASE_INDEX[row.phase]) return true;
  return due !== null && today >= addDays(due, -28);
}

function pageKey(url: string): string | null {
  return (
    url.match(/\/pages\/(?:edit-v2\/|edit\/)?(\d+)/)?.[1] ??
    url.match(/[?&]pageId=(\d+)/)?.[1] ??
    url.match(/draftId=(\d+)/)?.[1] ??
    null
  );
}

function isMismatch(ev: DocEvidence): boolean {
  if (!ev.link || !ev.page_url) return false;
  const a = pageKey(ev.link);
  const b = pageKey(ev.page_url);
  if (a === null || b === null) return false;
  return a !== b;
}

function rowStatus(row: DocRow, c: DocContext, ev: DocEvidence, due: string | null, today: string): DocStatus {
  const proposal = c.stage === null;
  const exists = Boolean(ev.link || ev.page_url);
  const linkPublished = Boolean(ev.link) && !/draftId=|resumedraft\.action/.test(ev.link!);
  const published = linkPublished || Boolean(ev.published);
  const complete = row.linkOnly
    ? linkPublished
    : published && (proposal || Boolean(ev.task_done)) && (!row.needsResults || Boolean(ev.results_filled));

  if (complete) return 'done';
  if (isStopped(c) || c.waivers[row.key] || (row.key === 'prd' && c.doc_mode === 'one_pager_only')) return 'waived';
  if (proposal) return exists ? 'draft' : 'missing';
  if (due === null) return 'cant_date';
  if (!isActive(row, c, due, today)) return 'inactive';
  if (today > due) return 'overdue';
  if (published) return 'review';
  if (exists) return 'draft';
  if (today >= addDays(due, -14)) return 'due_soon';
  return 'missing';
}

export function evaluateDocs(
  c: DocContext,
  evidence: Partial<Record<DocKey, DocEvidence>>,
  today: string,
): DocRowResult[] {
  const t = today.slice(0, 10);
  const results: DocRowResult[] = [];
  for (const row of DOC_MATRIX) {
    if (c.stage === null && row.key !== 'one_pager') continue;
    if (!row.required(c)) continue;
    const ev = evidence[row.key] ?? {};
    const proposal = c.stage === null;
    const { due, rule } = proposal ? { due: null, rule: row.due } : computeDue(row, c);
    const status = rowStatus(row, c, ev, due, t);
    results.push({
      key: row.key,
      label: row.label,
      phase: row.phase,
      due,
      due_rule: proposal ? 'Before roadmap' : describeRule(rule),
      needs:
        status === 'cant_date'
          ? [row.due, row.fallback].filter((x): x is DueRule => Boolean(x)).map((x) => ANCHOR_LABEL[x.anchor])
          : [],
      status,
      mismatch: isMismatch(ev),
      link: ev.link ?? ev.page_url ?? null,
    });
  }
  return results;
}

export function docRow(key: DocKey): DocRow {
  const row = DOC_MATRIX.find((r) => r.key === key);
  if (!row) throw new Error(`Unknown doc key: ${key}`);
  return row;
}

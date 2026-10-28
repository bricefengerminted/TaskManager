import type { ProjectRow, TaskRow, RoadmapItemRow } from '../db/schema';
import {
  DOC_MATRIX, evaluateDocs, daysBetween,
  type DocContext, type DocEvidence, type DocKey, type RoadmapStage,
} from '../../../shared/doc-matrix';

export const TEAM_ABBREV: Record<string, string> = {
  'Online Invites': 'OI',
  'Wedding Websites': 'WW',
  'Address Book': 'ABK',
  'Digital Products': 'DP',
};

/** Today's date in the server's local time zone (the user's Mac), as YYYY-MM-DD. */
export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export function serializeProject(p: ProjectRow, item?: RoadmapItemRow) {
  return {
    ...p,
    waivers: parseJson<Record<string, string>>(p.waivers, {}),
    customer_facing: Boolean(p.customer_facing),
    dev_start_half: item?.dev_start_half ?? null,
    roadmap_stage: item?.stage ?? null,
  };
}

export function buildContext(p: ProjectRow, item: RoadmapItemRow | undefined): DocContext {
  return {
    stage: p.docs_stage === 'roadmap' && item ? (item.stage as RoadmapStage) : null,
    phases: item ? parseJson(item.phases, {}) : {},
    entered_scope_at: item?.first_seen_at ?? null,
    doc_mode: p.doc_mode,
    customer_facing: Boolean(p.customer_facing),
    waivers: parseJson(p.waivers, {}),
    decision: p.decision ?? null,
  };
}

interface PageEvidence {
  page_url?: string | null;
  published?: boolean;
  results_filled?: boolean;
}

export function buildEvidence(
  p: ProjectRow,
  item: RoadmapItemRow | undefined,
  docTasks: TaskRow[],
): Partial<Record<DocKey, DocEvidence>> {
  const links = item ? parseJson<Record<string, string | null>>(item.links, {}) : {};
  const projectLinks: Record<string, string | null> = { hub: p.hub_url, onePager: p.one_pager_url };
  const out: Partial<Record<DocKey, DocEvidence>> = {};
  for (const row of DOC_MATRIX) {
    const task = docTasks.find((t) => t.doc_key === row.key);
    const page = parseJson<PageEvidence>(task?.doc_evidence, {});
    const field = row.roadmapLink;
    out[row.key] = {
      link: field ? (links[field] ?? projectLinks[field] ?? null) : null,
      page_url: page.page_url ?? null,
      published: page.published ?? false,
      results_filled: page.results_filled ?? false,
      task_done: task?.status === 'done',
    };
  }
  return out;
}

export function projectFlags(p: ProjectRow, item: RoadmapItemRow | undefined, today: string): string[] {
  const flags: string[] = [];
  if (p.docs_stage === 'roadmap' && !item) flags.push('roadmap_item_missing');
  if (p.docs_stage === 'roadmap' && item && !p.hub_url) flags.push('no_hub');
  if (p.docs_stage === 'proposal') {
    if (!p.decision && daysBetween(p.created_at, today) > 30) flags.push('awaiting_decision');
    if (p.decision === 'go' && p.decision_date && daysBetween(p.decision_date, today) > 14) flags.push('go_not_on_roadmap');
    if (p.decision === 'parked' && p.revisit_by && p.revisit_by <= today) flags.push('revisit_due');
  }
  return flags;
}

export function projectHealth(p: ProjectRow, item: RoadmapItemRow | undefined, docTasks: TaskRow[], today: string) {
  const rows = evaluateDocs(buildContext(p, item), buildEvidence(p, item, docTasks), today);
  const flags = projectFlags(p, item, today);
  if (rows.some((r) => r.mismatch)) flags.push('link_mismatch');
  return {
    project_id: p.id,
    name: p.name,
    team: p.team,
    half: item?.dev_start_half ?? null,
    roadmap_stage: item?.stage ?? null,
    roadmap_item_id: p.roadmap_item_id,
    hub_url: p.hub_url,
    docs_stage: p.docs_stage,
    decision: p.decision ?? null,
    flags,
    rows,
  };
}

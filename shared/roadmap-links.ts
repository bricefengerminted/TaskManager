// Copies doc links entered in TaskManager onto the roadmap item, one way, so each link is
// entered once. Only empty roadmap fields are filled; a different link already on the
// roadmap is never overwritten, it becomes a flag. Links only: dates and stages are the
// roadmap's. Pure; backend/src/scripts/doc-check.ts does the I/O.

import type { DocKey } from './doc-matrix';
import { confluencePageId, NEVER_LINK } from './confluence-migration';

/** TaskManager doc key → roadmap link field. */
export const ROADMAP_LINK_FIELDS = {
  prd: 'prd',
  release_notes: 'releaseNotes',
  'experiment_brief.plan': 'experimentBrief',
  one_pager: 'onePager',
  hub: 'hub',
  figma: 'figma',
  jira_epic: 'jiraEpic',
} as const satisfies Partial<Record<DocKey, string>>;

export type LinkDocKey = keyof typeof ROADMAP_LINK_FIELDS;
export type RoadmapLinkName = (typeof ROADMAP_LINK_FIELDS)[LinkDocKey];
export const LINK_DOC_KEYS = Object.keys(ROADMAP_LINK_FIELDS) as LinkDocKey[];

/** What TaskManager knows about one project's doc links. */
export interface ProjectLinkSource {
  hub_url: string | null;
  one_pager_url?: string | null;
  tasks: { doc_key?: string | null; doc_evidence?: string | null; links?: { url: string }[] }[];
}

const isHttps = (u: unknown): u is string => typeof u === 'string' && /^https:\/\/\S+$/i.test(u.trim());

/**
 * One link per doc key: the doc task's recorded page (doc evidence page_url), else the task's
 * first https link. Hub and one-pager fall back to the project's own URL fields.
 */
export function taskManagerLinks(src: ProjectLinkSource): Partial<Record<LinkDocKey, string>> {
  const out: Partial<Record<LinkDocKey, string>> = {};
  for (const key of LINK_DOC_KEYS) {
    const task = src.tasks.find((t) => t.doc_key === key);
    let pageUrl: unknown = null;
    try {
      pageUrl = task?.doc_evidence ? (JSON.parse(task.doc_evidence) as { page_url?: unknown }).page_url : null;
    } catch { /* unreadable evidence counts as none */ }
    const own = key === 'hub' ? src.hub_url : key === 'one_pager' ? src.one_pager_url : null;
    const url = [pageUrl, task?.links?.find((l) => isHttps(l.url))?.url, own].find(isHttps);
    if (url) out[key] = url.trim();
  }
  return out;
}

/** Same doc: same Confluence page id when both have one, else the same URL. */
export function sameLink(a: string, b: string): boolean {
  const pa = confluencePageId(a) ?? a.match(/draftId=(\d+)/)?.[1];
  const pb = confluencePageId(b) ?? b.match(/draftId=(\d+)/)?.[1];
  if (pa && pb) return pa === pb;
  return a.trim().replace(/\/+$/, '') === b.trim().replace(/\/+$/, '');
}

export interface LinkFill { itemId: string; item: string; project_id: string; field: RoadmapLinkName; value: string }
export interface LinkDiffers { project: string; item: string; field: RoadmapLinkName; roadmap: string; taskmanager: string }

export interface LinkPlanProject {
  project_id: string;
  name: string;
  team: string | null;
  roadmap_item_id: string | null;
}

export function planRoadmapLinks(
  projects: LinkPlanProject[],
  items: { id: string; name: string; links: Record<string, string | null> }[],
  tmLinks: Record<string, Partial<Record<LinkDocKey, string>>>,
): { fills: LinkFill[]; differs: LinkDiffers[] } {
  const fills: LinkFill[] = [];
  const differs: LinkDiffers[] = [];
  for (const p of projects) {
    const item = p.roadmap_item_id ? items.find((i) => i.id === p.roadmap_item_id) : undefined;
    if (!item) continue;
    const links = tmLinks[p.project_id] ?? {};
    for (const key of LINK_DOC_KEYS) {
      const value = links[key];
      if (!value) continue;
      const pageId = confluencePageId(value);
      if (NEVER_LINK.some((n) => n.pageId === pageId && n.notTeam === p.team)) continue;
      const field = ROADMAP_LINK_FIELDS[key];
      const current = item.links?.[field]?.trim() || null;
      if (!current) fills.push({ itemId: item.id, item: item.name, project_id: p.project_id, field, value });
      else if (!sameLink(current, value)) differs.push({ project: p.name, item: item.name, field, roadmap: current, taskmanager: value });
    }
  }
  return { fills, differs };
}

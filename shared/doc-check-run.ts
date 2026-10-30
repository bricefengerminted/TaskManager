// The doc check's pure core: Confluence tree + TaskManager health + roadmap → what to write.
// Spec §5; step-4 plan D3–D5. No I/O here; backend/src/scripts/doc-check.ts does that.

import { addDays, type DocEvidence, type DocKey } from './doc-matrix';
import type { DocHealthProject } from './types';
import type { AdfNode, GeneratedSection } from './confluence-adf';
import { classifyTitle } from './doc-evidence';
import { checklistContent, defaultSettings, itemDocRows, statusContent, type HubItem, type HubSettings } from './confluence-hub';
import { rollupContent, settingsContent, type RollupRow } from './confluence-rollup';
import { confluencePageId, NEVER_LINK } from './confluence-migration';
import { halfTitle } from './confluence-tree';
import { LINK_DOC_KEYS, planRoadmapLinks, type LinkDocKey, type LinkFill, type RoadmapLinkName } from './roadmap-links';

export interface TreePage { id: string; title: string; parentId: string | null; status: 'current' | 'draft' }

export interface DocCheckProject extends DocHealthProject { settings: HubSettings }

export type DocCheckItem = HubItem & { dev_start_half: string | null; updated_at?: string | null };

export interface DocCheckInput {
  today: string;
  /** URL prefix for page links, e.g. https://minted.atlassian.net/wiki/spaces/PM/pages/ */
  base: string;
  /** The Roadmap Projects root plus all its descendants. */
  tree: TreePage[];
  /** Manifest node key → page id (root, year:*, half:*, team_half:*, hub:*, proposals*, …). */
  manifest: Record<string, string>;
  projects: DocCheckProject[];
  items: DocCheckItem[];
  /** Page id → where it is already recorded as evidence. */
  recordedPageIds: Record<string, { project_id: string; key: DocKey }>;
  /** Page ids Brice marked "not a doc". */
  ignored: string[];
  /** project_id → doc links entered in TaskManager (taskManagerLinks), copied to empty roadmap fields. */
  tmLinks?: Record<string, Partial<Record<LinkDocKey, string>>>;
}

export interface Proposal { project_id: string; project: string; page_id: string; title: string; key: DocKey }
export type Flag =
  | { kind: 'no_hub'; project_id: string; project: string }
  | { kind: 'wrong_half'; page_id: string; title: string; expected: string }
  | { kind: 'unclassified'; page_id: string; title: string; hub: string }
  | { kind: 'mismatch'; project: string; doc: string }
  | { kind: 'roadmap_link_differs'; project: string; field: RoadmapLinkName; roadmap: string; taskmanager: string };
export interface SectionWrite { page_id: string; section: GeneratedSection; content: AdfNode[] }

export interface DocCheckOutput {
  /** project_id → evidence to send to POST /api/docs/apply. */
  evidence: Record<string, Partial<Record<DocKey, DocEvidence>>>;
  proposals: Proposal[];
  flags: Flag[];
  writes: SectionWrite[];
  /** Empty roadmap link fields to fill from TaskManager (sent with expected: null). */
  linkFills: LinkFill[];
  markdown: string;
}

const ROLLUP_KEY = /^(root|year:|half:|team_half:|proposals|team_proposals|not_pursued|team_not_pursued|unscheduled|team_unscheduled)/;
const HALF_TITLE = /^H[12]'\d\d$/;

export function planDocCheck(inp: DocCheckInput): DocCheckOutput {
  const byId = new Map(inp.tree.map((t) => [t.id, t]));
  const children = (id: string) => inp.tree.filter((t) => t.parentId === id);
  const ancestors = (id: string): TreePage[] => {
    const out: TreePage[] = [];
    const seen = new Set<string>();
    for (let cur = byId.get(id)?.parentId; cur && byId.has(cur) && !seen.has(cur); cur = byId.get(cur)!.parentId) {
      seen.add(cur);
      out.push(byId.get(cur)!);
    }
    return out;
  };

  const hubIds = new Set(Object.entries(inp.manifest).filter(([k]) => k.startsWith('hub:')).map(([, v]) => v));
  for (const p of inp.projects) {
    const id = confluencePageId(p.hub_url);
    if (id) hubIds.add(id);
  }

  const projectForHub = (hubId: string) =>
    inp.projects.find((p) => confluencePageId(p.hub_url) === hubId)
    ?? inp.projects.find((p) => p.roadmap_item_id && !p.hub_url && inp.manifest[`hub:${p.roadmap_item_id}`] === hubId);
  const itemForHub = (hubId: string) => {
    const key = Object.entries(inp.manifest).find(([k, v]) => k.startsWith('hub:') && v === hubId)?.[0];
    const itemId = key?.slice('hub:'.length) ?? projectForHub(hubId)?.roadmap_item_id ?? null;
    return inp.items.find((i) => i.id === itemId);
  };
  const rowsForHub = (hubId: string) => {
    const project = projectForHub(hubId);
    const item = itemForHub(hubId);
    return project?.rows ?? (item ? itemDocRows(item, inp.today, undefined, `${inp.base}${hubId}`) : []);
  };

  const evidence: DocCheckOutput['evidence'] = {};
  const proposals: Proposal[] = [];
  const flags: Flag[] = [];
  const writes: SectionWrite[] = [];

  for (const hubId of hubIds) {
    const hub = byId.get(hubId);
    if (!hub) continue;
    const project = projectForHub(hubId);
    const item = itemForHub(hubId);

    // Evidence and proposals from the hub's direct children.
    for (const c of children(hubId)) {
      if (inp.recordedPageIds[c.id] || inp.ignored.includes(c.id)) continue;
      const cls = classifyTitle(c.title);
      if (!cls) {
        flags.push({ kind: 'unclassified', page_id: c.id, title: c.title, hub: hub.title });
        continue;
      }
      if (!project) continue;
      if (NEVER_LINK.some((n) => n.pageId === c.id && n.notTeam === project.team)) continue;
      if (cls.confidence === 'exact') {
        const ev = (evidence[project.project_id] ??= {});
        if (!ev[cls.key]) ev[cls.key] = { page_url: `${inp.base}${c.id}`, published: c.status === 'current' };
      } else {
        proposals.push({ project_id: project.project_id, project: project.name, page_id: c.id, title: c.title, key: cls.key });
      }
    }

    // Generated sections.
    // The date shown is when the roadmap item last changed, so an unchanged item isn't rewritten daily.
    if (item) writes.push({ page_id: hubId, section: 'status', content: statusContent(item, item.updated_at?.slice(0, 10) ?? inp.today) });
    writes.push({ page_id: hubId, section: 'checklist', content: checklistContent(rowsForHub(hubId)) });
    writes.push({
      page_id: hubId,
      section: 'settings',
      content: settingsContent(project?.settings ?? defaultSettings({ stage: item?.stage ?? 'roadmap' })),
    });

    // Filed under the wrong half.
    if (item?.dev_start_half) {
      const expected = halfTitle(item.dev_start_half);
      const filedUnder = ancestors(hubId).find((a) => HALF_TITLE.test(a.title));
      if (filedUnder && filedUnder.title !== expected) flags.push({ kind: 'wrong_half', page_id: hubId, title: hub.title, expected });
    }
  }

  for (const p of inp.projects) {
    const hubId = confluencePageId(p.hub_url) ?? (p.roadmap_item_id ? inp.manifest[`hub:${p.roadmap_item_id}`] : undefined);
    if (p.docs_stage === 'roadmap' && !hubId) flags.push({ kind: 'no_hub', project_id: p.project_id, project: p.name });
    for (const r of p.rows) if (r.mismatch) flags.push({ kind: 'mismatch', project: p.name, doc: r.label });
  }

  // Roll-ups: every roll-up page lists the hubs beneath it.
  const rollupRow = (hubId: string): RollupRow => {
    const rows = rowsForHub(hubId);
    return {
      name: byId.get(hubId)!.title.replace(/ — Hub$/, ''),
      hubUrl: `${inp.base}${hubId}`,
      stage: itemForHub(hubId)?.stage ?? projectForHub(hubId)?.roadmap_stage ?? null,
      cells: Object.fromEntries(rows.map((r) => [r.key, r.status])),
      overdue: rows.filter((r) => r.status === 'overdue').length,
    };
  };
  for (const [key, pageId] of Object.entries(inp.manifest)) {
    if (!ROLLUP_KEY.test(key) || !byId.has(pageId)) continue;
    const under = [...hubIds].filter((h) => byId.has(h) && ancestors(h).some((a) => a.id === pageId));
    writes.push({ page_id: pageId, section: 'rollup', content: rollupContent(under.map(rollupRow)) });
  }

  // TaskManager → roadmap links. Pages this run just recorded count too, so a dry run shows them.
  const tmLinks: Record<string, Partial<Record<LinkDocKey, string>>> = {};
  for (const p of inp.projects) {
    const links = { ...inp.tmLinks?.[p.project_id] };
    for (const key of LINK_DOC_KEYS) {
      const url = evidence[p.project_id]?.[key]?.page_url;
      if (!links[key] && url) links[key] = url;
    }
    tmLinks[p.project_id] = links;
  }
  const { fills: linkFills, differs } = planRoadmapLinks(inp.projects, inp.items, tmLinks);
  for (const d of differs) flags.push({ kind: 'roadmap_link_differs', project: d.project, field: d.field, roadmap: d.roadmap, taskmanager: d.taskmanager });

  return { evidence, proposals, flags, writes, linkFills, markdown: renderMarkdown(inp, proposals, flags) };
}

function flagLine(f: Flag): string {
  switch (f.kind) {
    case 'no_hub': return `${f.project} has no hub`;
    case 'wrong_half': return `${f.title} should move to ${f.expected}`;
    case 'unclassified': return `"${f.title}" under ${f.hub} isn't a recognised doc (\`ignore ${f.page_id}\` to hide)`;
    case 'mismatch': return `${f.project}: ${f.doc} link differs between the roadmap and Confluence`;
    case 'roadmap_link_differs': return `${f.project}: roadmap ${f.field} is ${f.roadmap}, TaskManager has ${f.taskmanager} (not overwritten)`;
  }
}

function renderMarkdown(inp: DocCheckInput, proposals: Proposal[], flags: Flag[]): string {
  const soon = addDays(inp.today, 7);
  const overdue: string[] = [];
  const dueSoon: string[] = [];
  for (const p of inp.projects) {
    for (const r of p.rows) {
      if (r.status === 'overdue') overdue.push(`- 🔴 ${p.name}: ${r.label} (due ${r.due})`);
      else if (r.status === 'due_soon' && r.due && r.due <= soon) dueSoon.push(`- ⏳ ${p.name}: ${r.label} (due ${r.due})`);
    }
  }
  const lines = ['## 📚 Docs'];
  lines.push(overdue.length ? `**Overdue (${overdue.length})**\n${overdue.join('\n')}` : '**Overdue:** none');
  if (dueSoon.length) lines.push(`**Due this week**\n${dueSoon.join('\n')}`);
  if (proposals.length) {
    lines.push(`**Looks like a doc. Confirm?**\n${proposals
      .map((pr) => `- ${pr.project}: "${pr.title}" → ${pr.key} (\`accept ${pr.project_id} ${pr.key} ${pr.page_id}\`)`)
      .join('\n')}`);
  }
  if (flags.length) lines.push(`**Flags**\n${flags.map((f) => `- ${flagLine(f)}`).join('\n')}`);
  return lines.join('\n\n');
}

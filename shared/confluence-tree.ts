// Confluence page tree for roadmap projects: titles and creation order.
// Spec: docs/superpowers/specs/2026-10-28-project-docs-system-design.md §3

import { docRow, type DocKey } from './doc-matrix';

export const TEAM_ABBREV: Record<string, string> = {
  'Online Invites': 'OI',
  'Wedding Websites': 'WW',
  'Address Book': 'ABK',
  'Digital Products': 'DP',
};
export const TEAM_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(TEAM_ABBREV).map(([name, abbrev]) => [abbrev, name]),
);
/** Teams that get Proposals and Not Pursued pages up front. */
export const SUB_TEAMS = ['OI', 'WW', 'ABK'];
/** Roadmap stages that get a hub when the tree is scaffolded. */
export const HUB_STAGES = ['roadmap', 'build', 'measure'];

export function teamPrefix(teamName: string | null | undefined): string {
  const prefix = teamName ? TEAM_ABBREV[teamName.trim()] : undefined;
  if (!prefix) throw new Error(`Unknown team: ${teamName}`);
  return prefix;
}

/** The roadmap name trimmed, minus a leading copy of its own team prefix ("[OI] ", "OI - ", "OI – ", "OI: ", "OI "). */
export function displayName(name: string, prefix: string): string {
  const trimmed = name.trim();
  const re = new RegExp(`^(\\[${prefix}\\]|${prefix}\\s*[-–—:]|${prefix}\\s)\\s*`, 'i');
  return trimmed.replace(re, '').trim() || trimmed;
}

export function halfTitle(half: string): string {
  const m = half.match(/^(\d{4})-H([12])$/);
  if (!m) throw new Error(`Bad half: ${half}`);
  return `H${m[2]}'${m[1].slice(2)}`;
}

export const hubTitle = (prefix: string, name: string) => `[${prefix}] ${displayName(name, prefix)} — Hub`;
export const docPageTitle = (prefix: string, name: string, key: DocKey) =>
  `[${prefix}] ${displayName(name, prefix)} — ${docRow(key).pageTitle}`;

export type NodeKind =
  | 'root' | 'proposals' | 'team_proposals' | 'not_pursued' | 'team_not_pursued'
  | 'unscheduled' | 'team_unscheduled' | 'year' | 'half' | 'team_half' | 'hub';

export interface TreeNode {
  key: string;
  title: string;
  parentKey: string | null;
  kind: NodeKind;
  team?: string;
  half?: string;
  itemId?: string;
  /** Existing page that becomes this node (moved and renamed, never re-created). */
  adoptPageId?: string;
  offRoadmap?: boolean;
}

/** The roadmap fields the tree needs; matches GET /api/roadmap rows. */
export interface TreeItem {
  id: string;
  name: string;
  team_name: string | null;
  dev_start_half: string | null;
  stage: string;
}

export interface OffRoadmapHub {
  /** Stable key, e.g. the Jira idea key "IDEA-845". */
  key: string;
  name: string;
  team: string;
  pageId: string;
}

export interface TreeInput {
  items: TreeItem[];
  /** roadmap item id → existing page id that becomes its hub */
  adopt?: Record<string, string>;
  offRoadmap?: OffRoadmapHub[];
}

const HALF_RE = /^\d{4}-H[12]$/;

export function planTree(input: TreeInput): TreeNode[] {
  const nodes: TreeNode[] = [];
  const keys = new Set<string>();
  const titles = new Set<string>();
  const add = (n: TreeNode) => {
    if (keys.has(n.key)) return;
    if (titles.has(n.title)) throw new Error(`Duplicate title: ${n.title}`);
    keys.add(n.key);
    titles.add(n.title);
    nodes.push(n);
  };

  add({ key: 'root', title: 'Roadmap Projects', parentKey: null, kind: 'root' });
  add({ key: 'proposals', title: 'Proposals', parentKey: 'root', kind: 'proposals' });
  for (const t of SUB_TEAMS) add({ key: `proposals:${t}`, title: `Proposals · ${TEAM_NAME[t]}`, parentKey: 'proposals', kind: 'team_proposals', team: t });
  add({ key: 'not_pursued', title: 'Not Pursued', parentKey: 'root', kind: 'not_pursued' });
  for (const t of SUB_TEAMS) add({ key: `not_pursued:${t}`, title: `Not Pursued · ${TEAM_NAME[t]}`, parentKey: 'not_pursued', kind: 'team_not_pursued', team: t });
  add({ key: 'unscheduled', title: 'Unscheduled', parentKey: 'root', kind: 'unscheduled' });

  const inScope = input.items
    .filter((i) => HUB_STAGES.includes(i.stage))
    .map((i) => ({ ...i, prefix: teamPrefix(i.team_name), half: i.dev_start_half && HALF_RE.test(i.dev_start_half) ? i.dev_start_half : null }));

  const unscheduledTeams = new Set([
    ...inScope.filter((i) => !i.half).map((i) => i.prefix),
    ...(input.offRoadmap ?? []).map((o) => o.team),
  ]);
  for (const t of [...unscheduledTeams].sort()) {
    add({ key: `unscheduled:${t}`, title: `Unscheduled · ${TEAM_NAME[t]}`, parentKey: 'unscheduled', kind: 'team_unscheduled', team: t });
  }

  const halves = [...new Set(inScope.map((i) => i.half).filter((h): h is string => !!h))].sort();
  for (const year of [...new Set(halves.map((h) => h.slice(0, 4)))]) {
    add({ key: `year:${year}`, title: year, parentKey: 'root', kind: 'year' });
  }
  for (const half of halves) {
    add({ key: `half:${half}`, title: halfTitle(half), parentKey: `year:${half.slice(0, 4)}`, kind: 'half', half });
    const teams = [...new Set(inScope.filter((i) => i.half === half).map((i) => i.prefix))].sort();
    for (const t of teams) {
      add({ key: `team_half:${half}:${t}`, title: `${halfTitle(half)} · ${TEAM_NAME[t]}`, parentKey: `half:${half}`, kind: 'team_half', team: t, half });
    }
  }

  const hubs: TreeNode[] = [
    ...inScope.map((i): TreeNode => ({
      key: `hub:${i.id}`,
      title: hubTitle(i.prefix, i.name),
      parentKey: i.half ? `team_half:${i.half}:${i.prefix}` : `unscheduled:${i.prefix}`,
      kind: 'hub', team: i.prefix, itemId: i.id, ...(i.half ? { half: i.half } : {}),
      ...(input.adopt?.[i.id] ? { adoptPageId: input.adopt[i.id] } : {}),
    })),
    ...(input.offRoadmap ?? []).map((o): TreeNode => ({
      key: `hub:off:${o.key}`, title: hubTitle(o.team, o.name), parentKey: `unscheduled:${o.team}`,
      kind: 'hub', team: o.team, offRoadmap: true, adoptPageId: o.pageId,
    })),
  ];
  for (const hub of hubs.sort((a, b) => a.title.localeCompare(b.title))) add(hub);
  return nodes;
}

export interface TitleCollision {
  key: string;
  title: string;
  existingId: string;
}

/** Planned titles that already exist in the space (titles are unique per space). */
export function findTitleCollisions(nodes: TreeNode[], existing: { id: string; title: string }[]): TitleCollision[] {
  const byTitle = new Map(existing.map((e) => [e.title.trim(), e.id]));
  return nodes.flatMap((n) => {
    const id = byTitle.get(n.title);
    return id && id !== n.adoptPageId ? [{ key: n.key, title: n.title, existingId: id }] : [];
  });
}

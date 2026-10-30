// Ties tree, templates and migration together into one plan, plus the manifest Claude
// updates after every Confluence call. Pure: the CLI does the I/O.

import type { DocHealthProject } from './types';
import type { AdfDoc } from './confluence-adf';
import { planTree, findTitleCollisions, halfTitle, TEAM_NAME, type OffRoadmapHub, type TitleCollision, type TreeNode } from './confluence-tree';
import { itemDocRows, renderHubDoc, renderRollupDoc, defaultSettings, type HubItem, type HubSettings } from './confluence-hub';
import { buildMigrationList, proposePrdMatches, type MigrationRow, type PageRef } from './confluence-migration';

export interface PlanItem extends HubItem {
  dev_start_half: string | null;
  project_id: string | null;
}

export interface Inventory {
  cloudId: string;
  spaceId: string;
  /** Every page and folder title in the space (titles are unique per space). */
  existing: PageRef[];
  /** H1'26 PRDs under folder 3664740359. */
  prdPages: PageRef[];
  /** roadmap item id → personal-space canonical draft that becomes its hub */
  adopt: Record<string, string>;
  /** Canonical drafts for projects not on the roadmap (IDEA-845, IDEA-852). */
  offRoadmap: OffRoadmapHub[];
  legacy: PageRef[];
  adoptedTitles: Record<string, string>;
  /** PRD page id → hub node key, for matches Brice confirms by hand. */
  prdOverrides?: Record<string, string>;
}

export interface PlanInputs {
  today: string;
  items: PlanItem[];
  health: DocHealthProject[];
  projectSettings: Record<string, HubSettings>;
  inventory: Inventory;
}

export interface PlannedNode extends TreeNode {
  body: AdfDoc;
}

export interface Plan {
  today: string;
  nodes: PlannedNode[];
  collisions: TitleCollision[];
  migration: MigrationRow[];
}

function rollupIntro(n: TreeNode): string {
  switch (n.kind) {
    case 'root': return 'Start here: every roadmap project in Digital Products, its hub and its doc health.';
    case 'proposals': return 'One-pagers waiting for a Go / No-go / Parked decision, by team.';
    case 'team_proposals': return `Proposals for ${TEAM_NAME[n.team!]}: decision, age and owner.`;
    case 'not_pursued': return 'Proposals decided No-go. Nothing further is required for these.';
    case 'team_not_pursued': return `No-go proposals for ${TEAM_NAME[n.team!]}.`;
    case 'unscheduled': return 'Roadmap items with no Build start yet, and off-roadmap projects, by team.';
    case 'team_unscheduled': return `Unscheduled ${TEAM_NAME[n.team!]} projects.`;
    case 'year': return `Roadmap projects with a Build start in ${n.key.slice(5)}.`;
    case 'half': return `Roadmap projects starting Build in ${halfTitle(n.half!)}: project × doc status, overdue first.`;
    case 'team_half': return `${TEAM_NAME[n.team!]} projects starting Build in ${halfTitle(n.half!)}.`;
    default: return '';
  }
}

export function buildPlan(inp: PlanInputs): Plan {
  const nodes = planTree({ items: inp.items, adopt: inp.inventory.adopt, offRoadmap: inp.inventory.offRoadmap });
  const items = new Map(inp.items.map((i) => [i.id, i]));
  const healthByItem = new Map(inp.health.filter((h) => h.roadmap_item_id).map((h) => [h.roadmap_item_id!, h]));

  const planned: PlannedNode[] = nodes.map((n) => {
    if (n.kind !== 'hub') return { ...n, body: renderRollupDoc(rollupIntro(n)) };
    if (n.offRoadmap) {
      const stub: HubItem = { id: n.key, name: n.title, team_name: TEAM_NAME[n.team!], stage: '-', status: null, pm_name: null, jira_key: null, first_seen_at: null, phases: {}, links: {} };
      return { ...n, body: renderHubDoc({ item: stub, rows: [], today: inp.today, offRoadmap: true, settings: defaultSettings(stub) }) };
    }
    const item = items.get(n.itemId!)!;
    const health = healthByItem.get(item.id);
    const settings = (health && inp.projectSettings[health.project_id]) || defaultSettings(item);
    const rows = health ? health.rows : itemDocRows(item, inp.today, settings);
    return { ...n, body: renderHubDoc({ item, rows, today: inp.today, settings }) };
  });

  const collisions = findTitleCollisions(nodes, inp.inventory.existing);
  const migration = buildMigrationList({
    nodes, items: inp.items, collisions,
    prdMatches: proposePrdMatches(inp.inventory.prdPages, inp.items, Object.fromEntries(inp.items.map((i) => [i.id, i.links.prd ?? null]))),
    legacy: inp.inventory.legacy,
    adoptedTitles: inp.inventory.adoptedTitles,
    prdOverrides: inp.inventory.prdOverrides,
  });
  return { today: inp.today, nodes: planned, collisions, migration };
}

// ── manifest ───────────────────────────────────────────────────────

export interface ManifestEntry {
  title: string;
  pageId: string | null;
  status: 'draft' | 'current' | null;
  url: string | null;
}
export interface Manifest {
  cloudId: string;
  spaceId: string;
  /** Page the root is created under; null = top level of the space. */
  rootParentId: string | null;
  nodes: Record<string, ManifestEntry>;
}

export function emptyManifest(plan: Plan, cloudId: string, spaceId: string): Manifest {
  return {
    cloudId, spaceId, rootParentId: null,
    nodes: Object.fromEntries(plan.nodes.map((n) => [n.key, { title: n.title, pageId: n.adoptPageId ?? null, status: null, url: null }])),
  };
}

/** Next page to create: no page id yet, parent already exists. Adopted hubs are moved, never created. */
export function nextNode(plan: Plan, m: Manifest): PlannedNode | null {
  for (const n of plan.nodes) {
    if (n.adoptPageId) continue;
    if (m.nodes[n.key]?.pageId) continue;
    if (n.parentKey && !m.nodes[n.parentKey]?.pageId) continue;
    return n;
  }
  return null;
}

export function recordNode(m: Manifest, key: string, e: Omit<ManifestEntry, 'title'>): Manifest {
  const cur = m.nodes[key];
  if (!cur) throw new Error(`Unknown node: ${key}`);
  return { ...m, nodes: { ...m.nodes, [key]: { ...cur, ...e } } };
}

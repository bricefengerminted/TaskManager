// Migration of existing Confluence pages into the roadmap tree. Produces a list for approval;
// nothing here writes to Confluence. Spec: §3 "Migration".

import { docRow } from './doc-matrix';
import { docPageTitle, teamPrefix, HUB_SUFFIX, TITLE_SEP, type TitleCollision, type TreeItem, type TreeNode } from './confluence-tree';

export interface PageRef {
  id: string;
  title: string;
}

/** Pages that must never be matched to certain teams' items, whatever their title says. */
export const NEVER_LINK: { pageId: string; notTeam: string; reason: string }[] = [
  { pageId: '4286087221', notTeam: 'WW', reason: 'OI On-Canvas PRD. Never link to the WW On-Canvas item.' },
];

const PREFIX_RE = /^\s*(?:\[(OI|WW|ABK|DP)\]|(OI|WW|ABK|DP)\s*[-–—:])\s*/i;
const DOC_WORDS_RE = /(?:^|\s)(?:brief\/prd|prd|brief|product requirements(?: document)?)(?=\s|$)/gi;

export function normalizeTitle(title: string): { prefix: string | null; core: string } {
  const m = title.match(PREFIX_RE);
  const prefix = m ? (m[1] ?? m[2]).toUpperCase() : null;
  const core = title
    .replace(PREFIX_RE, '')
    .replace(DOC_WORDS_RE, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return { prefix, core };
}

export interface PrdMatch {
  page: PageRef;
  itemId: string | null;
  reason: 'linked' | 'exact' | 'contains' | 'ambiguous' | 'none' | 'blocked';
  candidates: string[];
}

/** Page id in a Confluence URL (/pages/<id>/… or ?pageId=<id>), or null. */
export function confluencePageId(url: string | null | undefined): string | null {
  return url?.match(/\/pages\/(\d+)/)?.[1] ?? url?.match(/[?&]pageId=(\d+)/)?.[1] ?? null;
}

/**
 * Proposes the roadmap item each PRD page belongs to. An existing roadmap PRD link
 * (prdLinks: item id → URL) wins over name matching. NEVER_LINK always applies.
 */
export function proposePrdMatches(pages: PageRef[], items: TreeItem[], prdLinks: Record<string, string | null> = {}): PrdMatch[] {
  const norm = items.map((i) => {
    const prefix = teamPrefix(i.team_name);
    return { id: i.id, prefix, core: normalizeTitle(i.name).core };
  });
  return pages.map((page) => {
    const t = normalizeTitle(page.title);
    const blockedTeams = NEVER_LINK.filter((b) => b.pageId === page.id).map((b) => b.notTeam);
    const sameTeam = norm.filter((i) => !t.prefix || i.prefix === t.prefix);
    const allowed = sameTeam.filter((i) => !blockedTeams.includes(i.prefix));
    const linked = norm.filter((i) => !blockedTeams.includes(i.prefix) && confluencePageId(prdLinks[i.id]) === page.id);
    if (linked.length === 1) return { page, itemId: linked[0].id, reason: 'linked' as const, candidates: [linked[0].id] };
    const pick = (pool: typeof norm) => {
      const exact = pool.filter((i) => i.core === t.core);
      if (exact.length) return { list: exact, kind: 'exact' as const };
      const contains = pool.filter((i) => t.core.length >= 4 && (i.core.includes(t.core) || t.core.includes(i.core)));
      return { list: contains, kind: 'contains' as const };
    };
    const found = pick(allowed);
    if (found.list.length === 1) return { page, itemId: found.list[0].id, reason: found.kind, candidates: [found.list[0].id] };
    if (found.list.length > 1) return { page, itemId: null, reason: 'ambiguous', candidates: found.list.map((i) => i.id) };
    const blockedHit = blockedTeams.length > 0 && pick(sameTeam).list.length > 0;
    return { page, itemId: null, reason: blockedHit ? 'blocked' : 'none', candidates: [] };
  });
}

export type MigrationAction = 'move_rename' | 'adopt_as_hub' | 'off_roadmap_hub' | 'rename_conflict' | 'banner' | 'leave';

export interface MigrationRow {
  n: number;
  action: MigrationAction;
  pageId: string;
  currentTitle: string;
  newTitle: string | null;
  /** Tree node key of the new parent; resolved to a page id from the manifest at execution time. */
  newParentKey: string | null;
  note: string;
}

export interface MigrationInput {
  nodes: TreeNode[];
  items: TreeItem[];
  prdMatches: PrdMatch[];
  collisions: TitleCollision[];
  /** Legacy pages (H1'25/H2'25 roots, old per-team canonical docs) that get a pointer banner. */
  legacy: PageRef[];
  /** Current titles of adopted pages, by page id; '' if unknown. */
  adoptedTitles?: Record<string, string>;
  /** Hand-picked matches the name matcher missed: PRD page id → hub node key. NEVER_LINK still applies. */
  prdOverrides?: Record<string, string>;
}

export const BANNER_TEXT =
  'This page predates the Roadmap Projects tree. Current project docs live under "Roadmap Projects" in this space.';

export function buildMigrationList(input: MigrationInput): MigrationRow[] {
  const rows: Omit<MigrationRow, 'n'>[] = [];
  const byId = new Map(input.items.map((i) => [i.id, i]));

  const hubs = new Map(input.nodes.filter((n) => n.kind === 'hub').map((n) => [n.key, n]));
  for (const m of input.prdMatches) {
    const overrideKey = input.prdOverrides?.[m.page.id];
    if (overrideKey) {
      const hub = hubs.get(overrideKey);
      if (!hub) throw new Error(`Unknown hub for override of ${m.page.id}: ${overrideKey}`);
      const banned = NEVER_LINK.find((b) => b.pageId === m.page.id && b.notTeam === hub.team);
      if (banned) throw new Error(`Override refused for ${m.page.id}: ${banned.reason}`);
      rows.push({
        action: 'move_rename', pageId: m.page.id, currentTitle: m.page.title,
        newTitle: hub.title.replace(HUB_SUFFIX, `${TITLE_SEP}${docRow('prd').pageTitle}`), newParentKey: hub.key,
        note: 'Suggested match (not found by name or roadmap link). Page ID and links are kept.',
      });
      continue;
    }
    const item = m.itemId ? byId.get(m.itemId) : undefined;
    if (item) {
      rows.push({
        action: 'move_rename', pageId: m.page.id, currentTitle: m.page.title,
        newTitle: docPageTitle(teamPrefix(item.team_name), item.name, 'prd'), newParentKey: `hub:${item.id}`,
        note: `${m.reason} match to "${item.name.trim()}". Page ID and links are kept.`,
      });
      continue;
    }
    const blocked = NEVER_LINK.find((b) => b.pageId === m.page.id);
    rows.push({
      action: 'leave', pageId: m.page.id, currentTitle: m.page.title, newTitle: null, newParentKey: null,
      note: m.reason === 'blocked' && blocked ? `Held back: ${blocked.reason}`
        : m.reason === 'ambiguous' ? `Ambiguous: could be ${m.candidates.join(', ')}. Brice to choose or leave.`
        : blocked ? `No match. ${blocked.reason}`
        : 'No roadmap match. Brice to assign or leave in place.',
    });
  }

  for (const n of input.nodes.filter((x) => x.kind === 'hub' && x.adoptPageId)) {
    rows.push({
      action: n.offRoadmap ? 'off_roadmap_hub' : 'adopt_as_hub',
      pageId: n.adoptPageId!, currentTitle: input.adoptedTitles?.[n.adoptPageId!] ?? '',
      newTitle: n.title, newParentKey: n.parentKey,
      note: n.offRoadmap
        ? 'Personal-space draft → team space under Unscheduled, marked off-roadmap. Existing content kept under "Background".'
        : 'Personal-space draft → team space as this item\'s hub. Existing content kept under "Background".',
    });
  }

  for (const c of input.collisions) {
    rows.push({
      action: 'rename_conflict', pageId: c.existingId, currentTitle: c.title, newTitle: `${c.title} (legacy)`, newParentKey: null,
      note: `Title needed by the new tree (${c.key}). Folders may need renaming in the UI.`,
    });
  }

  for (const l of input.legacy) {
    rows.push({ action: 'banner', pageId: l.id, currentTitle: l.title, newTitle: null, newParentKey: null, note: `Add info panel at top: "${BANNER_TEXT}"` });
  }

  return rows.map((r, i) => ({ n: i + 1, ...r }));
}

const cell = (s: string | null) => (s ?? '-').replace(/\|/g, '\\|');

export function renderMigrationMarkdown(rows: MigrationRow[]): string {
  return [
    '| # | Approve | Action | Page | Current title | New title | New parent | Note |',
    '|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.n} | [ ] | ${r.action} | ${r.pageId} | ${cell(r.currentTitle)} | ${cell(r.newTitle)} | ${cell(r.newParentKey)} | ${cell(r.note)} |`),
  ].join('\n');
}

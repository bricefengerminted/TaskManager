# Confluence Tree and Project Hubs Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers-extended-cc:subagent-driven-development (if subagents available) or superpowers-extended-cc:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every in-scope roadmap item has a `[XX] <name> — Hub` page in the Digital Products / Wedding Projects space (`221937685`), under a page tree of Roadmap Projects → Year → Half → Team, with machine-rewritable Status and Doc checklist sections. Existing PRDs and canonical drafts are moved into the tree only per a migration list Brice approves. Hub URLs flow back into TaskManager.

**Architecture:**
- **Pure TypeScript modules in `shared/`** decide everything deterministic: titles, the tree, hub and one-pager bodies (as ADF JSON), the generated-section markers and their replacement, PRD matching and the migration list. They are unit-tested with the existing backend Vitest harness.
- **A planning CLI** (`backend/src/scripts/confluence-plan.ts`) reads the roadmap snapshot and doc health from the local TaskManager API plus a Confluence inventory file, and writes the creation plan, the migration list and a manifest of page IDs.
- **Claude executes the plan through the Atlassian MCP, one call at a time**, recording each page ID in the manifest straight after the call returns. Every Confluence write in this plan is gated on Brice's approval; pages are created as drafts first.

**Tech Stack:** TypeScript (shared, backend), Vitest, ts-node, Atlassian Confluence MCP (`createConfluencePage`, `updateConfluencePage`, `getConfluencePage`, `searchConfluenceUsingCql`, `getConfluencePageDescendants`), TaskManager MCP (`sync_roadmap`, `get_doc_health`, `link_project`).

**Spec:** `docs/superpowers/specs/2026-10-28-project-docs-system-design.md`, §1 (lifecycle), §3 (Confluence structure), §5 (doc check), "Decisions". This is build-order **step 3**. Steps 1–2 are done (`docs/superpowers/plans/2026-10-28-project-docs-system.md`).

**Checked:** the code in Tasks 1–6 was dry-run in a scratch copy on 2026-10-28 (not committed): `tsc --noEmit` clean, and all 141 backend tests pass, 45 of them new.

**Out of scope (later plans):** the daily doc check that rewrites hubs and roll-ups and adds the briefing section (step 4); the proposals flow beyond the one-pager template and decision block (step 5); roadmap link write-back via `update_roadmap_links` (step 6).

---

## Hard rules for whoever executes this plan

1. **Atlassian MCP calls run strictly one at a time.** Never put two Atlassian calls in the same message, and never fan them out to subagents. Wait for each result before the next call. (Known Atlassian concurrency bug.)
2. **No Confluence write without Brice's approval in chat.** That covers create, publish, move, rename, body edits and banners. Approval is per batch named in the task (for example "create these 41 drafts"), never inferred from an earlier approval.
3. **Drafts first.** Every new page is created with `status: "draft"`. Publishing is its own approval (Task 13).
4. **Never link the OI On-Canvas PRD (`4286087221`) to the WW On-Canvas item.** The matcher enforces this (Task 5), and nobody may override it by hand.
5. **Never delete anything.** If a page must go away, Brice does it in the Confluence UI.
6. **Record before moving on.** After each successful create or update, run `npm run confluence -- record …` (Task 6) before the next Atlassian call, so a crash never leaves an unrecorded page that would be created twice.
7. **Never resend a page body you have not just fetched.** `updateConfluencePage` needs a body even for a move or rename. Fetch the page as ADF, change nothing but `title`/`parentId`/`spaceId`, and send the same ADF back. If the fetched ADF contains a `com.atlassian.confluence.migration` extension or the tool reports unsupported content, stop and ask Brice to move that page in the UI instead.

## Decisions this plan makes (Brice to confirm in Task 8)

- **Team prefix is not doubled.** Roadmap names often already start with the team (`WW - Modular Elements`, `[OI] Messaging Center`). The hub title strips a leading copy of the item's own prefix (`[OI] `, `OI - `, `OI – `, `OI: `), then uses the rest trimmed and verbatim: `[WW] Modular Elements — Hub`. The spec says "trimmed and otherwise verbatim"; without stripping we'd get `[WW] WW - Modular Elements — Hub`.
- **Generated-section markers.** HTML comments don't survive Confluence's ADF storage, so the spec's `<!-- doc-check:start/end -->` markers are realised as a **Page Properties macro (`details`) with a fixed label** (`doc-check-status`, `doc-check-checklist`, `doc-check-rollup`). It renders open (an expand would hide the checklist), holds tables, and its label is a stable parameter. The Task 9 spike confirms it round-trips; if it doesn't, the fallback is an **expand with a fixed title**. The replacement function accepts both forms.
- **Bodies are ADF.** Pages are created and rewritten with `contentFormat: "adf"`, so the doc check edits JSON nodes rather than regex-matching HTML.
- **Inactive rows appear in the checklist** as "Not active yet" (spec §2 says inactive rows are shown; §3 says "every active row"). It costs one row each and saves people asking where a doc went.
- **Team pages are created only where they have children**, except `Proposals · <Team>` and `Not Pursued · <Team>`, which are created for OI, WW and ABK up front. A `· Digital Products` page appears only if a DP item needs one.
- **Year pages are titled `2026`, `2027`** as in the spec. If the space already has a page or folder with that title (or `H1'26`, which the old half folder probably uses), the plan (Task 8) lists the collision and the migration list proposes renaming the old one to `<title> (legacy)`. Nothing is renamed without approval.
- **Unknown fields show ❓.** The roadmap snapshot has no Eng or UX owner, so the Status table shows "❓ Not in roadmap snapshot" for both, never a guess.
- **Hub URLs for items without a TaskManager project** stay in the manifest until Brice approves creating that project. Only the two linked projects (IDEA-850 → `oi-4`, IDEA-932 → `id-1773091064966-jyqedxkup`) get `link_project { hub_url }` in this plan.

---

## File map

**Shared (pure, no I/O)**
- Create `shared/confluence-adf.ts`: minimal ADF node builders; generated-section markers; `findGenerated`, `replaceGenerated`; `adfText`.
- Create `shared/confluence-tree.ts`: team prefixes, title functions, `planTree`, `findTitleCollisions`.
- Create `shared/confluence-hub.ts`: `itemDocRows`, `renderHubDoc`, `renderRollupDoc`, `STATUS_LABEL`.
- Create `shared/confluence-one-pager.ts`: `renderOnePagerDoc`, `parseDecision`.
- Create `shared/confluence-migration.ts`: `NEVER_LINK`, `normalizeTitle`, `proposePrdMatches`, `buildMigrationList`, `renderMigrationMarkdown`.
- Create `shared/confluence-plan.ts`: `buildPlan` (ties the above together) and the manifest type.

**Backend**
- Create `backend/src/scripts/confluence-plan.ts`: CLI with `plan`, `next`, `body`, `record` subcommands.
- Modify `backend/package.json`: `"confluence": "ts-node src/scripts/confluence-plan.ts"` script.
- Modify `backend/src/lib/doc-check.ts`: `TEAM_ABBREV` re-exported from `shared/confluence-tree.ts` (one source of truth).
- Tests: `backend/src/test/confluence-adf.test.ts`, `confluence-tree.test.ts`, `confluence-hub.test.ts`, `confluence-one-pager.test.ts`, `confluence-migration.test.ts`, `confluence-plan.test.ts`.

**Docs / data**
- Create `docs/confluence/README.md`: how the files below are used.
- Create (by the CLI) `docs/confluence/manifest.json` (committed): node key → title, page ID, status, URL.
- Create (by the CLI) `docs/confluence/migration-list.md` (committed): the approval list, with Brice's decisions recorded in it.
- Create (by Claude in Task 7) `docs/confluence/inventory/inventory.json` and (by the CLI) `docs/confluence/tree-plan.json`: working files, git-ignored.
- Modify `.gitignore`: `docs/confluence/inventory/` and `docs/confluence/tree-plan.json`.
- Modify `~/Claude Assistant/templates/one-pager.md` (outside the repo, not committed): add the decision block.

---

### Task 1: ADF builders and generated-section markers

**Goal:** A tiny ADF toolkit plus the marker contract: generated sections can be found and fully replaced without touching anything else on the page.

**Files:**
- Create: `shared/confluence-adf.ts`
- Test: `backend/src/test/confluence-adf.test.ts`

**Acceptance Criteria:**
- [ ] `replaceGenerated` swaps the content of exactly one marked section and leaves every other top-level node deep-equal to the input.
- [ ] It finds sections in both marker styles (`details` macro with label, or expand with fixed title).
- [ ] A missing marker returns `{ replaced: false, reason: 'missing' }`; two markers for the same section return `reason: 'duplicate'`; neither case changes the doc.
- [ ] The input doc is never mutated.

**Verify:** `cd backend && npx vitest run src/test/confluence-adf.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing tests.**

```ts
// backend/src/test/confluence-adf.test.ts
import { describe, it, expect } from 'vitest';
import {
  doc, h, p, text, generated, findGenerated, replaceGenerated, adfText, GENERATED,
  type AdfDoc,
} from '../../../shared/confluence-adf';

function hubLike(): AdfDoc {
  return doc([
    h(2, 'Status'),
    generated('status', [p(text('old status'))]),
    h(2, 'Links'),
    p(text('hand-written link notes')),
    generated('checklist', [p(text('old checklist'))]),
  ]);
}

describe('generated sections', () => {
  it('replaces only the marked section', () => {
    const before = hubLike();
    const res = replaceGenerated(before, 'status', [p(text('new status'))]);
    expect(res.replaced).toBe(true);
    expect(adfText(res.doc.content[1])).toContain('new status');
    expect(adfText(res.doc.content[1])).not.toContain('old status');
    expect(res.doc.content[3]).toEqual(before.content[3]);
    expect(res.doc.content[4]).toEqual(before.content[4]);
  });

  it('does not mutate the input', () => {
    const before = hubLike();
    const snapshot = JSON.parse(JSON.stringify(before));
    replaceGenerated(before, 'checklist', [p(text('x'))]);
    expect(before).toEqual(snapshot);
  });

  it('finds the expand fallback form', () => {
    const d = doc([
      { type: 'expand', attrs: { title: GENERATED.status.title }, content: [p(text('old'))] },
    ]);
    expect(findGenerated(d, 'status')).toEqual([0]);
    const res = replaceGenerated(d, 'status', [p(text('new'))]);
    expect(res.replaced).toBe(true);
    expect(res.doc.content[0].type).toBe('expand');
    expect(adfText(res.doc)).toContain('new');
  });

  it('reports a missing marker without changing the doc', () => {
    const d = doc([p(text('no markers here'))]);
    const res = replaceGenerated(d, 'status', [p(text('new'))]);
    expect(res).toEqual({ doc: d, replaced: false, reason: 'missing' });
  });

  it('refuses to guess when a marker is duplicated', () => {
    const d = doc([generated('status', [p(text('a'))]), generated('status', [p(text('b'))])]);
    const res = replaceGenerated(d, 'status', [p(text('new'))]);
    expect(res).toMatchObject({ replaced: false, reason: 'duplicate' });
  });

  it('generated sections start with a do-not-edit note', () => {
    expect(adfText(generated('checklist', []))).toContain('Generated by the doc check');
  });
});
```

- [ ] **Step 2: Run them to see them fail.** `cd backend && npx vitest run src/test/confluence-adf.test.ts` → fails: cannot find module `shared/confluence-adf`.

- [ ] **Step 3: Implement `shared/confluence-adf.ts`.**

```ts
// Minimal ADF (Atlassian Document Format) helpers for Confluence pages written by Claude.
// Spec: docs/superpowers/specs/2026-10-28-project-docs-system-design.md §3

export interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}
export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
  marks?: AdfMark[];
}
export interface AdfDoc {
  type: 'doc';
  version: 1;
  content: AdfNode[];
}

export const doc = (content: AdfNode[]): AdfDoc => ({ type: 'doc', version: 1, content });
export const text = (t: string, marks?: AdfMark[]): AdfNode =>
  marks?.length ? { type: 'text', text: t, marks } : { type: 'text', text: t };
export const em = (t: string) => text(t, [{ type: 'em' }]);
export const strong = (t: string) => text(t, [{ type: 'strong' }]);
export const link = (label: string, href: string) => text(label, [{ type: 'link', attrs: { href } }]);
/** Empty text nodes are invalid ADF, so an empty paragraph has no content. */
export const p = (...inline: AdfNode[]): AdfNode =>
  inline.length ? { type: 'paragraph', content: inline } : { type: 'paragraph' };
export const h = (level: 1 | 2 | 3, t: string): AdfNode => ({ type: 'heading', attrs: { level }, content: [text(t)] });
export const bulletList = (items: AdfNode[][]): AdfNode => ({
  type: 'bulletList',
  content: items.map((inline) => ({ type: 'listItem', content: [p(...inline)] })),
});
export const panel = (panelType: 'info' | 'note' | 'warning' | 'success' | 'error', content: AdfNode[]): AdfNode => ({
  type: 'panel', attrs: { panelType }, content,
});

/** A table with a header row. Each cell is a list of inline nodes. */
export function table(header: string[], rows: AdfNode[][][]): AdfNode {
  const cell = (type: 'tableHeader' | 'tableCell', inline: AdfNode[]): AdfNode => ({ type, content: [p(...inline)] });
  return {
    type: 'table',
    content: [
      { type: 'tableRow', content: header.map((t) => cell('tableHeader', [strong(t)])) },
      ...rows.map((r) => ({ type: 'tableRow', content: r.map((c) => cell('tableCell', c)) })),
    ],
  };
}

// ── generated sections ─────────────────────────────────────────────

export type GeneratedSection = 'status' | 'checklist' | 'rollup';

/** label: Page Properties macro label (primary marker). title: expand title (fallback marker). */
export const GENERATED: Record<GeneratedSection, { label: string; title: string }> = {
  status: { label: 'doc-check-status', title: 'Status — generated by the doc check' },
  checklist: { label: 'doc-check-checklist', title: 'Doc checklist — generated by the doc check' },
  rollup: { label: 'doc-check-rollup', title: 'Roll-up — generated by the doc check' },
};

/** Which marker form new pages use. Task 9 confirms 'details'; switch to 'expand' if it fails. */
export const MARKER_STYLE: 'details' | 'expand' = 'details';

const NOTE = 'Generated by the doc check. Edits inside this box are overwritten.';

export function generated(section: GeneratedSection, content: AdfNode[]): AdfNode {
  const body = [p(em(NOTE)), ...content];
  if (MARKER_STYLE === 'expand') {
    return { type: 'expand', attrs: { title: GENERATED[section].title }, content: body };
  }
  return {
    type: 'bodiedExtension',
    attrs: {
      extensionType: 'com.atlassian.confluence.macro.core',
      extensionKey: 'details',
      parameters: {
        macroParams: { label: { value: GENERATED[section].label } },
        macroMetadata: { schemaVersion: { value: '1' }, title: 'Page Properties' },
      },
      layout: 'default',
    },
    content: body,
  };
}

function isMarker(node: AdfNode, section: GeneratedSection): boolean {
  const m = GENERATED[section];
  if (node.type === 'expand') return node.attrs?.title === m.title;
  if (node.type === 'bodiedExtension' && node.attrs?.extensionKey === 'details') {
    const params = node.attrs.parameters as { macroParams?: { label?: { value?: string } } } | undefined;
    return params?.macroParams?.label?.value === m.label;
  }
  return false;
}

/** Indexes of top-level nodes that mark this section. Markers are only looked for at the top level. */
export function findGenerated(d: AdfDoc, section: GeneratedSection): number[] {
  return d.content.flatMap((n, i) => (isMarker(n, section) ? [i] : []));
}

export type ReplaceResult =
  | { doc: AdfDoc; replaced: true }
  | { doc: AdfDoc; replaced: false; reason: 'missing' | 'duplicate' };

/** Replace a generated section's content, keeping its marker node and everything else. Never mutates. */
export function replaceGenerated(d: AdfDoc, section: GeneratedSection, content: AdfNode[]): ReplaceResult {
  const at = findGenerated(d, section);
  if (at.length === 0) return { doc: d, replaced: false, reason: 'missing' };
  if (at.length > 1) return { doc: d, replaced: false, reason: 'duplicate' };
  const old = d.content[at[0]];
  const next: AdfNode = { ...old, content: generated(section, content).content };
  return { doc: { ...d, content: d.content.map((n, i) => (i === at[0] ? next : n)) }, replaced: true };
}

/** All text in a node, space-joined. For tests and for parsing hand-written tables. */
export function adfText(n: AdfNode | AdfDoc): string {
  if ('text' in n && typeof n.text === 'string') return n.text;
  return (n.content ?? []).map((c) => adfText(c)).filter(Boolean).join(' ');
}
```

- [ ] **Step 4: Run the tests.** Same command → all pass.

- [ ] **Step 5: Commit.**

```bash
git add shared/confluence-adf.ts backend/src/test/confluence-adf.test.ts
git commit -m "feat(confluence): ADF helpers and generated-section markers"
```

---

### Task 2: Titles and the page tree

**Goal:** Deterministic, space-unique titles and an ordered list of every page the tree needs, parents before children.

**Files:**
- Create: `shared/confluence-tree.ts`
- Modify: `backend/src/lib/doc-check.ts:7-12` (re-export `TEAM_ABBREV`)
- Test: `backend/src/test/confluence-tree.test.ts`

**Acceptance Criteria:**
- [ ] `hubTitle('WW', 'WW - Modular Elements ')` → `[WW] Modular Elements — Hub`; `[OI] Messaging Center` → `[OI] Messaging Center — Hub`.
- [ ] `halfTitle('2026-H2')` → `H2'26`; team-half title is `H2'26 · Online Invites`.
- [ ] `planTree` puts every node after its parent, creates team-half pages only where items exist, sends items with no `dev_start_half` to `Unscheduled · <Team>`, skips stages outside roadmap/build/measure, and throws on two items with the same hub title.
- [ ] Adopted items keep the existing page ID on their hub node; off-roadmap hubs go under `Unscheduled · <Team>` with `offRoadmap: true`.
- [ ] `findTitleCollisions` lists planned titles that already exist in the space, except a node's own adopted page.
- [ ] Existing backend tests still pass after the `TEAM_ABBREV` re-export.

**Verify:** `cd backend && npx vitest run` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing tests.**

```ts
// backend/src/test/confluence-tree.test.ts
import { describe, it, expect } from 'vitest';
import {
  hubTitle, docPageTitle, halfTitle, teamPrefix, displayName, planTree, findTitleCollisions,
  type TreeItem,
} from '../../../shared/confluence-tree';

const item = (o: Partial<TreeItem>): TreeItem => ({
  id: 'x', name: 'Thing', team_name: 'Online Invites', dev_start_half: '2026-H2', stage: 'build', ...o,
});

describe('titles', () => {
  it('maps teams to prefixes', () => {
    expect(teamPrefix('Online Invites')).toBe('OI');
    expect(teamPrefix('Wedding Websites')).toBe('WW');
    expect(teamPrefix('Address Book')).toBe('ABK');
    expect(teamPrefix('Digital Products')).toBe('DP');
    expect(() => teamPrefix('Marketing')).toThrow(/Unknown team/);
  });

  it('strips a leading copy of the own team prefix only', () => {
    expect(displayName('WW - Modular Elements ', 'WW')).toBe('Modular Elements');
    expect(displayName('[OI] Messaging Center', 'OI')).toBe('Messaging Center');
    expect(displayName('OI – Messaging Center – Iteration', 'OI')).toBe('Messaging Center – Iteration');
    expect(displayName('OI: On-Canvas Editing', 'OI')).toBe('On-Canvas Editing');
    expect(displayName('WW - Modular Elements', 'OI')).toBe('WW - Modular Elements');
    expect(displayName('Oil painting', 'OI')).toBe('Oil painting');
  });

  it('builds hub and doc page titles', () => {
    expect(hubTitle('WW', 'WW - Modular Elements ')).toBe('[WW] Modular Elements — Hub');
    expect(docPageTitle('OI', '[OI] Messaging Center', 'prd')).toBe('[OI] Messaging Center — Brief/PRD');
    expect(docPageTitle('OI', 'Messaging Center', 'experiment_brief.results')).toBe('[OI] Messaging Center — Experiment Brief');
  });

  it('formats halves', () => {
    expect(halfTitle('2026-H2')).toBe("H2'26");
    expect(halfTitle('2027-H1')).toBe("H1'27");
    expect(() => halfTitle('2026')).toThrow();
  });
});

describe('planTree', () => {
  const items: TreeItem[] = [
    item({ id: 'oi-4', name: '[OI] Messaging Center', dev_start_half: '2026-H1' }),
    item({ id: 'ww-1', name: 'WW - Modular Elements', team_name: 'Wedding Websites' }),
    item({ id: 'ww-2', name: 'WW - Someday', team_name: 'Wedding Websites', dev_start_half: null, stage: 'roadmap' }),
    item({ id: 'done-1', name: 'Shipped', stage: 'done' }),
  ];

  it('orders parents before children', () => {
    const nodes = planTree({ items });
    const pos = new Map(nodes.map((n, i) => [n.key, i]));
    for (const n of nodes) if (n.parentKey) expect(pos.get(n.parentKey)!).toBeLessThan(pos.get(n.key)!);
    expect(nodes[0]).toMatchObject({ key: 'root', title: 'Roadmap Projects', parentKey: null });
  });

  it('creates the expected structure', () => {
    const titles = planTree({ items }).map((n) => n.title);
    expect(titles).toEqual(expect.arrayContaining([
      'Proposals', 'Proposals · Online Invites', 'Proposals · Wedding Websites', 'Proposals · Address Book',
      'Not Pursued', 'Not Pursued · Online Invites', 'Not Pursued · Wedding Websites', 'Not Pursued · Address Book',
      'Unscheduled', 'Unscheduled · Wedding Websites',
      '2026', "H1'26", "H1'26 · Online Invites", "H2'26", "H2'26 · Wedding Websites",
      '[OI] Messaging Center — Hub', '[WW] Modular Elements — Hub', '[WW] Someday — Hub',
    ]));
    expect(titles).not.toContain("H2'26 · Online Invites");
    expect(titles).not.toContain('Unscheduled · Online Invites');
    expect(titles.some((t) => t.includes('Shipped'))).toBe(false);
  });

  it('parents hubs by half and team', () => {
    const nodes = planTree({ items });
    expect(nodes.find((n) => n.key === 'hub:oi-4')!.parentKey).toBe('team_half:2026-H1:OI');
    expect(nodes.find((n) => n.key === 'hub:ww-2')!.parentKey).toBe('unscheduled:WW');
  });

  it('keeps adopted page ids and places off-roadmap hubs', () => {
    const nodes = planTree({
      items,
      adopt: { 'oi-4': '4198498306' },
      offRoadmap: [{ key: 'IDEA-845', name: 'Guest Photos', team: 'OI', pageId: '4226482184' }],
    });
    expect(nodes.find((n) => n.key === 'hub:oi-4')!.adoptPageId).toBe('4198498306');
    expect(nodes.find((n) => n.key === 'hub:off:IDEA-845')).toMatchObject({
      title: '[OI] Guest Photos — Hub', parentKey: 'unscheduled:OI', offRoadmap: true, adoptPageId: '4226482184',
    });
  });

  it('throws on duplicate hub titles', () => {
    expect(() => planTree({ items: [item({ id: 'a', name: 'Same' }), item({ id: 'b', name: '[OI] Same' })] }))
      .toThrow(/Duplicate title/);
  });
});

describe('findTitleCollisions', () => {
  it('lists existing titles, but not a node colliding with its own adopted page', () => {
    const nodes = planTree({
      items: [item({ id: 'oi-4', name: 'Messaging Center', dev_start_half: '2026-H1' })],
      adopt: { 'oi-4': '42' },
    });
    const existing = [
      { id: '3664740359', title: "H1'26" },
      { id: '42', title: '[OI] Messaging Center — Hub' },
      { id: '7', title: 'Something else' },
    ];
    expect(findTitleCollisions(nodes, existing)).toEqual([
      { key: 'half:2026-H1', title: "H1'26", existingId: '3664740359' },
    ]);
  });
});
```

- [ ] **Step 2: Run them to see them fail.** `cd backend && npx vitest run src/test/confluence-tree.test.ts` → module not found.

- [ ] **Step 3: Implement `shared/confluence-tree.ts`.**

```ts
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

/** The roadmap name trimmed, minus a leading copy of its own team prefix ("[OI] ", "OI - ", "OI – ", "OI: "). */
export function displayName(name: string, prefix: string): string {
  const trimmed = name.trim();
  const re = new RegExp(`^(\\[${prefix}\\]|${prefix}\\s*[-–—:])\\s*`, 'i');
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
```

- [ ] **Step 4: Make the backend use the shared map.** In `backend/src/lib/doc-check.ts`, replace the `TEAM_ABBREV` literal (lines 7–12) with:

```ts
export { TEAM_ABBREV } from '../../../shared/confluence-tree';
```

If any file in `backend/src` uses `TEAM_ABBREV` inside `doc-check.ts` itself, add `import { TEAM_ABBREV } from '../../../shared/confluence-tree';` as well. Check with `grep -rn TEAM_ABBREV backend/src`.

- [ ] **Step 5: Run all backend tests.** `cd backend && npx vitest run` → all pass (new and existing).

- [ ] **Step 6: Commit.**

```bash
git add shared/confluence-tree.ts backend/src/lib/doc-check.ts backend/src/test/confluence-tree.test.ts
git commit -m "feat(confluence): page titles and tree planner"
```

---

### Task 3: Hub and roll-up page templates

**Goal:** `renderHubDoc` produces the hub page body: generated Status and Doc checklist sections, then the hand-written Links, Decisions log, Open questions and Settings sections. Roll-up pages get one generated section.

**Files:**
- Create: `shared/confluence-hub.ts`
- Test: `backend/src/test/confluence-hub.test.ts`

**Acceptance Criteria:**
- [ ] The hub has, in order: an off-roadmap warning (only when off-roadmap), `Status` + generated status, `Doc checklist` + generated checklist, `Links`, `Decisions log`, `Open questions`, `Settings`, and `Background (from the original page)` only when adopted content is passed.
- [ ] The Status table shows stage, status, team, PM, Eng, UX, Jira key and every phase's dates. Missing values show `—`; Eng and UX show `❓ Not in roadmap snapshot`.
- [ ] The checklist has one row per evaluated doc row, with emoji status, due date, rule and link; `cant_date` shows `❓ Can't date: needs <field>`.
- [ ] `itemDocRows` evaluates an item with no TaskManager project from roadmap data alone, waiving `one_pager` ("predates system") for items in build or measure.
- [ ] Settings shows doc mode, the customer-facing flag and waivers in a two-column table.
- [ ] Re-rendering the generated sections of a hub with `replaceGenerated` leaves the hand-written sections untouched (round-trip test).

**Verify:** `cd backend && npx vitest run src/test/confluence-hub.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing tests.**

```ts
// backend/src/test/confluence-hub.test.ts
import { describe, it, expect } from 'vitest';
import { adfText, p, text, replaceGenerated, findGenerated } from '../../../shared/confluence-adf';
import { renderHubDoc, renderRollupDoc, itemDocRows, statusContent, checklistContent, type HubItem } from '../../../shared/confluence-hub';

const ww: HubItem = {
  id: 'ww-modular', name: 'WW - Modular Elements ', team_name: 'Wedding Websites', stage: 'build', status: 'on-track',
  pm_name: 'Brice Fenger', jira_key: 'IDEA-932', first_seen_at: '2026-10-28T00:00:00.000Z',
  phases: { discovery: { start: '2026-03-01', end: '2026-03-30' }, build: { start: '2026-08-04', end: '2026-11-10' }, measure: { start: '2026-11-10', end: '2026-12-01' } },
  links: { prd: null, figma: null, jiraEpic: null, releaseNotes: null },
};
const headings = (d: ReturnType<typeof renderHubDoc>) =>
  d.content.filter((n) => n.type === 'heading').map((n) => adfText(n));

describe('itemDocRows', () => {
  it('evaluates from roadmap data and waives the one-pager for build items', () => {
    const rows = itemDocRows(ww, '2026-10-28');
    expect(rows.find((r) => r.key === 'one_pager')!.status).toBe('waived');
    expect(rows.find((r) => r.key === 'prd')!.status).toBe('overdue');
    expect(rows.find((r) => r.key === 'hub')).toBeDefined();
  });
  it('does not waive the one-pager for roadmap-stage items', () => {
    const rows = itemDocRows({ ...ww, stage: 'roadmap' }, '2026-10-28');
    expect(rows.find((r) => r.key === 'one_pager')!.status).not.toBe('waived');
  });
  it('uses roadmap links as evidence', () => {
    const rows = itemDocRows({ ...ww, links: { ...ww.links, jiraEpic: 'https://minted.atlassian.net/browse/DP-1' } }, '2026-10-28');
    expect(rows.find((r) => r.key === 'jira_epic')!.status).toBe('done');
  });
});

describe('renderHubDoc', () => {
  const today = '2026-10-28';
  const hub = renderHubDoc({ item: ww, rows: itemDocRows(ww, today), today });

  it('has the sections in order', () => {
    expect(headings(hub)).toEqual(['Status', 'Doc checklist', 'Links', 'Decisions log', 'Open questions', 'Settings']);
    expect(findGenerated(hub, 'status')).toHaveLength(1);
    expect(findGenerated(hub, 'checklist')).toHaveLength(1);
  });

  it('fills the status table and never guesses', () => {
    const s = adfText({ type: 'x', content: statusContent(ww, today) });
    expect(s).toContain('build');
    expect(s).toContain('Wedding Websites');
    expect(s).toContain('Brice Fenger');
    expect(s).toContain('IDEA-932');
    expect(s).toContain('2026-08-04 → 2026-11-10');
    expect(s).toContain('❓ Not in roadmap snapshot');
    expect(s).toContain('UX Research —');
  });

  it('labels checklist statuses', () => {
    const c = adfText({ type: 'x', content: checklistContent([
      { key: 'prd', label: 'Brief/PRD', phase: 'ux', due: '2026-07-21', due_rule: 'Build start −2w', needs: [], status: 'overdue', mismatch: false, link: null },
      { key: 'figma', label: 'Figma', phase: 'ux', due: null, due_rule: 'Build start', needs: ['Build start'], status: 'cant_date', mismatch: false, link: null },
    ]) });
    expect(c).toContain('🔴 Overdue');
    expect(c).toContain("❓ Can't date: needs Build start");
  });

  it('adds the off-roadmap warning and adopted content', () => {
    const d = renderHubDoc({ item: ww, rows: [], today, offRoadmap: true, adoptedContent: [p(text('old canonical notes'))] });
    expect(d.content[0].type).toBe('panel');
    expect(adfText(d.content[0])).toContain('Off-roadmap');
    expect(headings(d).at(-1)).toBe('Background (from the original page)');
    expect(adfText(d)).toContain('old canonical notes');
  });

  it('shows settings, including waivers', () => {
    const d = renderHubDoc({ item: ww, rows: [], today, settings: { doc_mode: 'full', customer_facing: true, waivers: { one_pager: 'predates system' } } });
    const s = adfText(d);
    expect(s).toContain('doc_mode full');
    expect(s).toContain('customer-facing launch yes');
    expect(s).toContain('one_pager — predates system');
  });

  it('survives a rewrite of its generated sections', () => {
    const edited = structuredClone(hub);
    const linksIdx = edited.content.findIndex((n) => adfText(n) === 'Links');
    edited.content.splice(linksIdx + 1, 1, p(text('Slack: #oi-messaging')));
    const r1 = replaceGenerated(edited, 'status', statusContent({ ...ww, stage: 'measure' }, today));
    const r2 = replaceGenerated(r1.doc, 'checklist', checklistContent([]));
    expect(adfText(r2.doc)).toContain('Slack: #oi-messaging');
    expect(adfText(r2.doc)).toContain('measure');
  });
});

describe('renderRollupDoc', () => {
  it('has an intro and one generated roll-up section', () => {
    const d = renderRollupDoc('Roll-up of H2\'26 projects.');
    expect(adfText(d.content[0])).toContain("H2'26");
    expect(findGenerated(d, 'rollup')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run them to see them fail.** `cd backend && npx vitest run src/test/confluence-hub.test.ts` → module not found.

- [ ] **Step 3: Implement `shared/confluence-hub.ts`.**

```ts
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
export function itemDocRows(item: HubItem, today: string, settings: HubSettings = defaultSettings(item)): DocRowResult[] {
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
```

- [ ] **Step 4: Run the tests.** Same command → all pass. If `prd` isn't `overdue` for the fixture on 2026-10-28, check `isActive` in `shared/doc-matrix.ts` and fix the fixture, not the module: build started 2026-08-04, so PRD was due 2026-07-21.

- [ ] **Step 5: Commit.**

```bash
git add shared/confluence-hub.ts backend/src/test/confluence-hub.test.ts
git commit -m "feat(confluence): hub and roll-up page templates"
```

---

### Task 4: One-pager template and decision block

**Goal:** A Confluence one-pager body that opens with a Decision block (Go / No-go / Parked, date, reason, revisit-by), and a parser the doc check will use to read it.

**Files:**
- Create: `shared/confluence-one-pager.ts`
- Test: `backend/src/test/confluence-one-pager.test.ts`
- Modify (outside repo, not committed): `~/Claude Assistant/templates/one-pager.md`

**Acceptance Criteria:**
- [ ] The one-pager starts with a Page Properties block labelled `one-pager-decision` holding a Decision / Date / Reason / Revisit by table, defaulting to `Pending`.
- [ ] The rest follows the existing one-pager template: problem, proposal, why now, expected impact, level of effort, key risk, stakeholders, ask, related.
- [ ] `parseDecision` reads `Go`, `No-go` (also `No go`, `nogo`), `Parked` and `Pending`, case-insensitively.
- [ ] It reports errors, and returns `decision: null`, when a decision has no date or reason, when Parked has no revisit-by date, or when a date isn't `YYYY-MM-DD`.
- [ ] A page without the block returns `{ decision: null, errors: ['no decision block'] }`.

**Verify:** `cd backend && npx vitest run src/test/confluence-one-pager.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing tests.**

```ts
// backend/src/test/confluence-one-pager.test.ts
import { describe, it, expect } from 'vitest';
import { adfText, doc, p, text } from '../../../shared/confluence-adf';
import { renderOnePagerDoc, parseDecision, decisionBlock } from '../../../shared/confluence-one-pager';

const withDecision = (v: { decision: string; date?: string; reason?: string; revisit_by?: string }) =>
  doc([decisionBlock(v)]);

describe('renderOnePagerDoc', () => {
  it('starts with a pending decision block and has the template sections', () => {
    const d = renderOnePagerDoc({ prefix: 'OI', name: 'Guest Photos', author: 'Brice Fenger', date: '2026-10-28' });
    expect(d.content[0].type).toBe('bodiedExtension');
    expect(parseDecision(d)).toEqual({ decision: null, pending: true, date: null, reason: null, revisit_by: null, errors: [] });
    const s = adfText(d);
    for (const label of ['The problem', 'The proposal', 'Why now', 'Expected impact', 'Level of effort', 'Key risk', 'Key stakeholders', 'Ask', 'Related']) {
      expect(s).toContain(label);
    }
  });
});

describe('parseDecision', () => {
  it('reads Go', () => {
    expect(parseDecision(withDecision({ decision: 'Go', date: '2026-10-28', reason: 'Strong signal' }))).toMatchObject({
      decision: 'go', date: '2026-10-28', reason: 'Strong signal', errors: [],
    });
  });
  it('normalizes No-go spellings', () => {
    for (const v of ['No-go', 'no go', 'NOGO', 'No-Go']) {
      expect(parseDecision(withDecision({ decision: v, date: '2026-10-28', reason: 'Low impact' })).decision).toBe('no_go');
    }
  });
  it('requires revisit-by for Parked', () => {
    const r = parseDecision(withDecision({ decision: 'Parked', date: '2026-10-28', reason: 'Wait for Q1 data' }));
    expect(r.decision).toBeNull();
    expect(r.errors).toContain('Parked needs a revisit-by date');
    expect(parseDecision(withDecision({ decision: 'Parked', date: '2026-10-28', reason: 'Wait', revisit_by: '2027-01-15' })).decision).toBe('parked');
  });
  it('requires a valid date and a reason', () => {
    const r = parseDecision(withDecision({ decision: 'Go', date: 'next week' }));
    expect(r.decision).toBeNull();
    expect(r.errors).toEqual(expect.arrayContaining(['Date must be YYYY-MM-DD', 'Reason is required']));
  });
  it('rejects unknown values', () => {
    expect(parseDecision(withDecision({ decision: 'Maybe', date: '2026-10-28', reason: 'x' })).errors).toContain('Unknown decision: Maybe');
  });
  it('handles a page without the block', () => {
    expect(parseDecision(doc([p(text('just text'))]))).toMatchObject({ decision: null, errors: ['no decision block'] });
  });
});
```

- [ ] **Step 2: Run them to see them fail.** `cd backend && npx vitest run src/test/confluence-one-pager.test.ts` → module not found.

- [ ] **Step 3: Implement `shared/confluence-one-pager.ts`.**

```ts
// One-pager page body and its Decision block (Go / No-go / Parked).
// Spec: docs/superpowers/specs/2026-10-28-project-docs-system-design.md §1

import { adfText, doc, em, h, p, strong, table, text, type AdfDoc, type AdfNode } from './confluence-adf';
import { displayName } from './confluence-tree';

export const DECISION_LABEL = 'one-pager-decision';

export interface DecisionValues {
  decision: string;
  date?: string;
  reason?: string;
  revisit_by?: string;
}

/** Hand-written by the PM; read (never rewritten) by the doc check. */
export function decisionBlock(v: DecisionValues): AdfNode {
  const row = (k: string, val: string | undefined): AdfNode[][] => [[text(k)], val ? [text(val)] : []];
  return {
    type: 'bodiedExtension',
    attrs: {
      extensionType: 'com.atlassian.confluence.macro.core',
      extensionKey: 'details',
      parameters: {
        macroParams: { label: { value: DECISION_LABEL } },
        macroMetadata: { schemaVersion: { value: '1' }, title: 'Page Properties' },
      },
      layout: 'default',
    },
    content: [
      p(em('Decision: Go, No-go, Parked or Pending. Go/No-go/Parked need a date (YYYY-MM-DD) and a one-line reason; Parked also needs a revisit-by date.')),
      table(['Field', 'Value'], [
        row('Decision', v.decision),
        row('Date', v.date),
        row('Reason', v.reason),
        row('Revisit by', v.revisit_by),
      ]),
    ],
  };
}

export interface OnePagerInput {
  prefix: string;
  name: string;
  author: string;
  date: string;
}

export function renderOnePagerDoc(i: OnePagerInput): AdfDoc {
  const field = (label: string, hint: string) => p(strong(`${label}: `), em(hint));
  return doc([
    decisionBlock({ decision: 'Pending' }),
    p(text(`${displayName(i.name, i.prefix)} · ${i.date} · ${i.author}`)),
    field('The problem', '2–3 sentences: what is broken or missing, and who feels the pain.'),
    field('The proposal', '2–3 sentences: what we would build and how it solves the problem.'),
    field('Why now', 'What changed: market signal, data, customer feedback.'),
    field('Expected impact', '[metric] moves from [X] to [Y].'),
    field('Level of effort', 'S / M / L, with a one-line justification.'),
    field('Key risk', 'The one thing that could sink this.'),
    h(3, 'Key stakeholders'),
    table(['Role', 'Person', 'Involvement'], [
      [[text('PM')], [text(i.author)], [text('Owner')]],
      [[text('Eng Lead')], [], []],
      [[text('Design')], [], []],
    ]),
    field('Ask', 'Approval, resources, design review or an eng estimate.'),
    field('Related', 'Jira tickets, prior attempts, relevant decisions.'),
  ]);
}

export interface ParsedDecision {
  decision: 'go' | 'no_go' | 'parked' | null;
  pending: boolean;
  date: string | null;
  reason: string | null;
  revisit_by: string | null;
  errors: string[];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function normalize(v: string): ParsedDecision['decision'] | 'pending' | undefined {
  const k = v.toLowerCase().replace(/[^a-z]/g, '');
  return ({ go: 'go', nogo: 'no_go', parked: 'parked', pending: 'pending', '': 'pending' } as const)[k as 'go'];
}

function findBlock(nodes: AdfNode[]): AdfNode | undefined {
  for (const n of nodes) {
    const params = n.attrs?.parameters as { macroParams?: { label?: { value?: string } } } | undefined;
    if (n.type === 'bodiedExtension' && params?.macroParams?.label?.value === DECISION_LABEL) return n;
    const inner = n.content && findBlock(n.content);
    if (inner) return inner;
  }
  return undefined;
}

export function parseDecision(d: AdfDoc): ParsedDecision {
  const empty: ParsedDecision = { decision: null, pending: false, date: null, reason: null, revisit_by: null, errors: [] };
  const block = findBlock(d.content);
  const tableNode = block?.content?.find((n) => n.type === 'table');
  if (!tableNode) return { ...empty, errors: ['no decision block'] };

  const fields: Record<string, string> = {};
  for (const row of tableNode.content ?? []) {
    const [k, v] = (row.content ?? []).map((c) => adfText(c).trim());
    if (k) fields[k.toLowerCase()] = v ?? '';
  }
  const raw = fields['decision'] ?? '';
  const value = normalize(raw);
  const date = fields['date'] || null;
  const reason = fields['reason'] || null;
  const revisit_by = fields['revisit by'] || null;
  const out: ParsedDecision = { ...empty, date, reason, revisit_by };

  if (value === undefined) return { ...out, errors: [`Unknown decision: ${raw}`] };
  if (value === 'pending') return { ...out, pending: true };
  if (!date || !ISO.test(date)) out.errors.push('Date must be YYYY-MM-DD');
  if (!reason) out.errors.push('Reason is required');
  if (value === 'parked' && (!revisit_by || !ISO.test(revisit_by))) out.errors.push('Parked needs a revisit-by date');
  return out.errors.length ? out : { ...out, decision: value };
}
```

- [ ] **Step 4: Run the tests.** Same command → all pass.

- [ ] **Step 5: Add the decision block to the local markdown template.** In `~/Claude Assistant/templates/one-pager.md`, insert this right after the `# [Idea Name]` / date line, so one-pagers drafted locally carry the same block. This file is outside the repo, so it isn't committed.

```markdown
| Decision | Pending |
|---|---|
| Date | |
| Reason | |
| Revisit by | |

> Decision: Go, No-go, Parked or Pending. Go/No-go/Parked need a date (YYYY-MM-DD) and a one-line reason; Parked also needs a revisit-by date. In Confluence this table sits inside a Page Properties macro labelled `one-pager-decision`.
```

Also change its "Save to" line to: `Save to artifacts/prds/YYYY-MM-DD-[idea-name]-one-pager.md, then publish to Confluence under "Proposals · <Team>" as "[XX] <idea> — One-Pager".`

- [ ] **Step 6: Commit.**

```bash
git add shared/confluence-one-pager.ts backend/src/test/confluence-one-pager.test.ts
git commit -m "feat(confluence): one-pager template with decision block"
```

---

### Task 5: PRD matching and the migration list

**Goal:** Turn the Confluence inventory into a numbered approval list covering every move, rename, adoption, title conflict and banner. PRD matches are proposals, and the On-Canvas guard is enforced in code.

**Files:**
- Create: `shared/confluence-migration.ts`
- Test: `backend/src/test/confluence-migration.test.ts`

**Acceptance Criteria:**
- [ ] `normalizeTitle` handles all three title styles (`[OI] X PRD`, `OI: X`, `PRD - X`, `X — Brief/PRD`) → `{ prefix, core }`.
- [ ] `proposePrdMatches` matches by normalized name within the same team. An exact core match beats containment; two or more candidates are `ambiguous`; none is `none`.
- [ ] Page `4286087221` is never matched to a WW item, even with an exact name match (`reason: 'blocked'`).
- [ ] `buildMigrationList` emits a `move_rename` row per matched PRD (new title `[XX] <name> — Brief/PRD`, parent `hub:<itemId>`), `leave` rows for unmatched, ambiguous and blocked PRDs, an `adopt_as_hub` row per adopted draft, an `off_roadmap_hub` row per off-roadmap draft, a `rename_conflict` row per title collision, and a `banner` row per legacy page.
- [ ] `renderMigrationMarkdown` renders one table with an empty `Approve` column, and the On-Canvas row says why it is held back.

**Verify:** `cd backend && npx vitest run src/test/confluence-migration.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing tests.**

```ts
// backend/src/test/confluence-migration.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeTitle, proposePrdMatches, buildMigrationList, renderMigrationMarkdown } from '../../../shared/confluence-migration';
import { planTree, type TreeItem } from '../../../shared/confluence-tree';

const items: TreeItem[] = [
  { id: 'oi-4', name: '[OI] Messaging Center', team_name: 'Online Invites', dev_start_half: '2026-H1', stage: 'build' },
  { id: 'ww-oce', name: 'WW - On-Canvas Editing', team_name: 'Wedding Websites', dev_start_half: '2026-H2', stage: 'roadmap' },
  { id: 'ww-mod', name: 'WW - Modular Elements', team_name: 'Wedding Websites', dev_start_half: '2026-H2', stage: 'build' },
  { id: 'ww-mod2', name: 'WW - Modular Elements Phase 2', team_name: 'Wedding Websites', dev_start_half: '2026-H2', stage: 'roadmap' },
];

describe('normalizeTitle', () => {
  it('handles the three title styles', () => {
    expect(normalizeTitle('[OI] Messaging Center PRD')).toEqual({ prefix: 'OI', core: 'messaging center' });
    expect(normalizeTitle('OI: On-Canvas Editing')).toEqual({ prefix: 'OI', core: 'on canvas editing' });
    expect(normalizeTitle('PRD - Modular Elements')).toEqual({ prefix: null, core: 'modular elements' });
    expect(normalizeTitle('[WW] Modular Elements — Brief/PRD')).toEqual({ prefix: 'WW', core: 'modular elements' });
  });
});

describe('proposePrdMatches', () => {
  it('matches exact names within the team', () => {
    const [m] = proposePrdMatches([{ id: '3748462617', title: '[OI] Messaging Center PRD' }], items);
    expect(m).toMatchObject({ itemId: 'oi-4', reason: 'exact' });
  });

  it('prefers exact over containment', () => {
    const [m] = proposePrdMatches([{ id: '1', title: 'PRD - Modular Elements' }], items);
    expect(m).toMatchObject({ itemId: 'ww-mod', reason: 'exact' });
  });

  it('flags ambiguity instead of guessing', () => {
    const [m] = proposePrdMatches([{ id: '2', title: 'PRD - Modular' }], items);
    expect(m.reason).toBe('ambiguous');
    expect(m.itemId).toBeNull();
    expect(m.candidates.sort()).toEqual(['ww-mod', 'ww-mod2']);
  });

  it('never links the OI On-Canvas PRD to the WW On-Canvas item', () => {
    const [m] = proposePrdMatches([{ id: '4286087221', title: 'On-Canvas Editing' }], items);
    expect(m.itemId).toBeNull();
    expect(m.reason).toBe('blocked');
  });

  it('respects the page prefix', () => {
    const [m] = proposePrdMatches([{ id: '3', title: 'OI: On-Canvas Editing' }], items);
    expect(m).toMatchObject({ itemId: null, reason: 'none' });
  });
});

describe('buildMigrationList', () => {
  it('lists every kind of change, numbered', () => {
    const nodes = planTree({
      items,
      adopt: { 'ww-mod': '4198498306' },
      offRoadmap: [{ key: 'IDEA-845', name: 'Guest Photos', team: 'OI', pageId: '4226482184' }],
    });
    const rows = buildMigrationList({
      nodes,
      items,
      prdMatches: proposePrdMatches(
        [{ id: '3748462617', title: '[OI] Messaging Center PRD' }, { id: '4286087221', title: 'OI: On-Canvas Editing' }],
        items,
      ),
      collisions: [{ key: 'half:2026-H1', title: "H1'26", existingId: '3664740359' }],
      legacy: [{ id: '111', title: "H1'25" }],
    });
    expect(rows.map((r) => r.n)).toEqual(rows.map((_, i) => i + 1));
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'move_rename', pageId: '3748462617', newTitle: '[OI] Messaging Center — Brief/PRD', newParentKey: 'hub:oi-4' }),
      expect.objectContaining({ action: 'leave', pageId: '4286087221' }),
      expect.objectContaining({ action: 'adopt_as_hub', pageId: '4198498306', newTitle: '[WW] Modular Elements — Hub', newParentKey: 'team_half:2026-H2:WW' }),
      expect.objectContaining({ action: 'off_roadmap_hub', pageId: '4226482184', newTitle: '[OI] Guest Photos — Hub', newParentKey: 'unscheduled:OI' }),
      expect.objectContaining({ action: 'rename_conflict', pageId: '3664740359', newTitle: "H1'26 (legacy)" }),
      expect.objectContaining({ action: 'banner', pageId: '111' }),
    ]));
    const md = renderMigrationMarkdown(rows);
    expect(md).toContain('| # | Approve | Action | Page | Current title | New title | New parent | Note |');
    expect(md).toMatch(/4286087221.*Never link to the WW On-Canvas item/);
  });
});
```

- [ ] **Step 2: Run them to see them fail.** `cd backend && npx vitest run src/test/confluence-migration.test.ts` → module not found.

- [ ] **Step 3: Implement `shared/confluence-migration.ts`.**

```ts
// Migration of existing Confluence pages into the roadmap tree. Produces a list for approval;
// nothing here writes to Confluence. Spec: §3 "Migration".

import { docPageTitle, teamPrefix, type TitleCollision, type TreeItem, type TreeNode } from './confluence-tree';

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
  reason: 'exact' | 'contains' | 'ambiguous' | 'none' | 'blocked';
  candidates: string[];
}

export function proposePrdMatches(pages: PageRef[], items: TreeItem[]): PrdMatch[] {
  const norm = items.map((i) => {
    const prefix = teamPrefix(i.team_name);
    return { id: i.id, prefix, core: normalizeTitle(i.name).core };
  });
  return pages.map((page) => {
    const t = normalizeTitle(page.title);
    const blockedTeams = NEVER_LINK.filter((b) => b.pageId === page.id).map((b) => b.notTeam);
    const sameTeam = norm.filter((i) => !t.prefix || i.prefix === t.prefix);
    const allowed = sameTeam.filter((i) => !blockedTeams.includes(i.prefix));
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
}

export const BANNER_TEXT =
  'This page predates the Roadmap Projects tree. Current project docs live under "Roadmap Projects" in this space.';

export function buildMigrationList(input: MigrationInput): MigrationRow[] {
  const rows: Omit<MigrationRow, 'n'>[] = [];
  const byId = new Map(input.items.map((i) => [i.id, i]));

  for (const m of input.prdMatches) {
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

const cell = (s: string | null) => (s ?? '—').replace(/\|/g, '\\|');

export function renderMigrationMarkdown(rows: MigrationRow[]): string {
  return [
    '| # | Approve | Action | Page | Current title | New title | New parent | Note |',
    '|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.n} | [ ] | ${r.action} | ${r.pageId} | ${cell(r.currentTitle)} | ${cell(r.newTitle)} | ${cell(r.newParentKey)} | ${cell(r.note)} |`),
  ].join('\n');
}
```

- [ ] **Step 4: Run the tests.** Same command → all pass. If the "respects the page prefix" case fails because `OI: On-Canvas Editing` (page id `3`) contains-matches nothing on OI, that is the expected `none`; if it matches a WW item, the prefix filter is wrong. Fix the module.

- [ ] **Step 5: Commit.**

```bash
git add shared/confluence-migration.ts backend/src/test/confluence-migration.test.ts
git commit -m "feat(confluence): PRD matching and migration list with On-Canvas guard"
```

---

### Task 6: Planning CLI and manifest

**Goal:** One command builds the full plan (nodes with bodies, collisions, migration list) from the TaskManager API and the inventory file, and small subcommands let Claude step through creation one page at a time, recording each page ID.

**Files:**
- Create: `shared/confluence-plan.ts`
- Create: `backend/src/scripts/confluence-plan.ts`
- Create: `docs/confluence/README.md`
- Modify: `backend/package.json` (scripts), `.gitignore`
- Test: `backend/src/test/confluence-plan.test.ts`

**Acceptance Criteria:**
- [ ] `buildPlan` returns every tree node with an ADF `body`. Hubs of linked projects use the project's `/api/docs/health` rows and settings; other hubs use `itemDocRows`.
- [ ] `nextNode` returns the first node with no page ID whose parent has one (or is the root), and skips adopted hubs (those are migration rows, not creates).
- [ ] `recordNode` writes `{ pageId, status, url }` for a key and refuses an unknown key.
- [ ] `npm run confluence -- plan` writes `docs/confluence/tree-plan.json`, `docs/confluence/migration-list.md` and (if missing) `docs/confluence/manifest.json`, and prints counts plus collisions.
- [ ] `npm run confluence -- next` prints the next node's key, title, parent page ID and the body file path; `body <key>` writes the ADF to a temp file; `record <key> <pageId> <draft|current> <url>` updates the manifest.

**Verify:** `cd backend && npx vitest run src/test/confluence-plan.test.ts` → all pass; `npx tsc --noEmit -p .` → no errors.

**Steps:**

- [ ] **Step 1: Write the failing tests.**

```ts
// backend/src/test/confluence-plan.test.ts
import { describe, it, expect } from 'vitest';
import { buildPlan, emptyManifest, nextNode, recordNode, type PlanInputs } from '../../../shared/confluence-plan';
import { adfText } from '../../../shared/confluence-adf';

const inputs: PlanInputs = {
  today: '2026-10-28',
  items: [
    { id: 'oi-4', name: '[OI] Messaging Center', team_name: 'Online Invites', dev_start_half: '2026-H1', stage: 'build', status: 'on-track',
      pm_name: 'Brice Fenger', jira_key: 'IDEA-850', first_seen_at: '2026-10-28', phases: { build: { start: '2026-03-01', end: '2026-06-30' } }, links: {}, project_id: 'p1' },
    { id: 'ww-1', name: 'WW - Modular Elements', team_name: 'Wedding Websites', dev_start_half: '2026-H2', stage: 'roadmap', status: null,
      pm_name: null, jira_key: null, first_seen_at: '2026-10-28', phases: {}, links: {}, project_id: null },
  ],
  health: [{
    project_id: 'p1', name: '[IDEA-850] Messaging Center', team: 'OI', half: '2026-H1', roadmap_stage: 'build', roadmap_item_id: 'oi-4',
    hub_url: null, docs_stage: 'roadmap', decision: null, flags: [],
    rows: [{ key: 'prd', label: 'Brief/PRD', phase: 'ux', due: '2026-02-15', due_rule: 'Build start −2w', needs: [], status: 'overdue', mismatch: false, link: null }],
  }],
  projectSettings: { p1: { doc_mode: 'full', customer_facing: false, waivers: { one_pager: 'predates system' } } },
  inventory: { cloudId: 'c', spaceId: '221937685', existing: [{ id: '3664740359', title: "H1'26" }], prdPages: [], adopt: {}, offRoadmap: [], legacy: [], adoptedTitles: {} },
};

describe('buildPlan', () => {
  const plan = buildPlan(inputs);
  it('gives every node a body', () => {
    expect(plan.nodes.length).toBeGreaterThan(10);
    for (const n of plan.nodes) expect(n.body.type).toBe('doc');
  });
  it('uses doc health for linked projects', () => {
    const hub = plan.nodes.find((n) => n.key === 'hub:oi-4')!;
    expect(adfText(hub.body)).toContain('🔴 Overdue');
    expect(adfText(hub.body)).toContain('one_pager — predates system');
  });
  it('reports collisions and builds the migration list', () => {
    expect(plan.collisions).toEqual([{ key: 'half:2026-H1', title: "H1'26", existingId: '3664740359' }]);
    expect(plan.migration.some((r) => r.action === 'rename_conflict')).toBe(true);
  });
});

describe('manifest stepping', () => {
  const plan = buildPlan(inputs);
  it('walks parents first and records ids', () => {
    let m = emptyManifest(plan, 'c', '221937685');
    expect(nextNode(plan, m)!.key).toBe('root');
    m = recordNode(m, 'root', { pageId: '100', status: 'draft', url: 'https://x/100' });
    const n2 = nextNode(plan, m)!;
    expect(plan.nodes.find((n) => n.key === n2.key)!.parentKey).toBe('root');
    expect(() => recordNode(m, 'nope', { pageId: '1', status: 'draft', url: '' })).toThrow(/Unknown node/);
  });
  it('skips adopted hubs', () => {
    const p2 = buildPlan({ ...inputs, inventory: { ...inputs.inventory, adopt: { 'ww-1': '4198498306' } } });
    let m = emptyManifest(p2, 'c', '221937685');
    const seen: string[] = [];
    for (let n = nextNode(p2, m); n; n = nextNode(p2, m)) {
      seen.push(n.key);
      m = recordNode(m, n.key, { pageId: String(seen.length), status: 'draft', url: '' });
    }
    expect(seen).not.toContain('hub:ww-1');
    expect(seen).toContain('hub:oi-4');
  });
});
```

- [ ] **Step 2: Run them to see them fail.** `cd backend && npx vitest run src/test/confluence-plan.test.ts` → module not found.

- [ ] **Step 3: Implement `shared/confluence-plan.ts`.**

```ts
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
    case 'year': return `Roadmap projects with a Build start in ${n.title}.`;
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
      const stub: HubItem = { id: n.key, name: n.title, team_name: TEAM_NAME[n.team!], stage: '—', status: null, pm_name: null, jira_key: null, first_seen_at: null, phases: {}, links: {} };
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
    prdMatches: proposePrdMatches(inp.inventory.prdPages, inp.items),
    legacy: inp.inventory.legacy,
    adoptedTitles: inp.inventory.adoptedTitles,
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
```

Note: an adopted hub's parent is a planned page, so `nextNode` creates the parent; the adopted page is moved under it in Task 11. Adopted pages already have a `pageId` in the manifest, so their own children (none at scaffold time) would not be blocked.

- [ ] **Step 4: Implement the CLI `backend/src/scripts/confluence-plan.ts`.**

```ts
// Usage (from backend/):
//   npm run confluence -- plan                 build tree-plan.json, migration-list.md, manifest.json (if missing)
//   npm run confluence -- next                 show the next page to create
//   npm run confluence -- body <key>           write that node's ADF body to a temp file and print the path
//   npm run confluence -- record <key> <pageId> <draft|current> <url>
// Reads the TaskManager API at TASKMANAGER_API_URL (default http://localhost:3001/api).

import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { buildPlan, emptyManifest, nextNode, recordNode, type Inventory, type Manifest, type Plan, type PlanItem } from '../../../shared/confluence-plan';
import { renderMigrationMarkdown } from '../../../shared/confluence-migration';
import type { HubSettings } from '../../../shared/confluence-hub';
import type { DocHealthResponse } from '../../../shared/types';
import { todayIso } from '../lib/doc-check';

const API = process.env.TASKMANAGER_API_URL || 'http://localhost:3001/api';
const DIR = resolve(__dirname, '../../../docs/confluence');
const PLAN = join(DIR, 'tree-plan.json');
const MANIFEST = join(DIR, 'manifest.json');
const MIGRATION = join(DIR, 'migration-list.md');
const INVENTORY = join(DIR, 'inventory/inventory.json');

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const writeJson = (path: string, v: unknown) => writeFileSync(path, JSON.stringify(v, null, 2) + '\n');

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return (await res.json()) as T;
}

async function plan() {
  const inventory = readJson<Inventory>(INVENTORY);
  const items = await get<PlanItem[]>('/roadmap');
  const health = await get<DocHealthResponse>('/docs/health');
  const projects = await get<{ id: string; doc_mode: HubSettings['doc_mode']; customer_facing: boolean; waivers: HubSettings['waivers'] }[]>('/projects');
  const projectSettings = Object.fromEntries(projects.map((p) => [p.id, { doc_mode: p.doc_mode ?? 'full', customer_facing: Boolean(p.customer_facing), waivers: p.waivers ?? {} }]));
  const p = buildPlan({ today: todayIso(), items, health: health.projects, projectSettings, inventory });
  writeJson(PLAN, p);
  writeFileSync(MIGRATION, `# Confluence migration list\n\nGenerated ${p.today}. Mark **Approve** with [x] (do it) or [-] (skip). Nothing runs until Brice has marked a row.\n\n${renderMigrationMarkdown(p.migration)}\n`);
  if (!existsSync(MANIFEST)) writeJson(MANIFEST, emptyManifest(p, inventory.cloudId, inventory.spaceId));
  else {
    // Add nodes that are new since the last plan; never touch recorded ones.
    const m = readJson<Manifest>(MANIFEST);
    const fresh = emptyManifest(p, m.cloudId, m.spaceId);
    writeJson(MANIFEST, { ...m, nodes: { ...fresh.nodes, ...m.nodes } });
  }
  const hubs = p.nodes.filter((n) => n.kind === 'hub').length;
  console.log(`${p.nodes.length} nodes (${hubs} hubs), ${p.collisions.length} title collisions, ${p.migration.length} migration rows.`);
  for (const c of p.collisions) console.log(`  collision: "${c.title}" already exists as ${c.existingId} (${c.key})`);
}

function next() {
  const p = readJson<Plan>(PLAN);
  const m = readJson<Manifest>(MANIFEST);
  const n = nextNode(p, m);
  if (!n) return console.log('Nothing left to create.');
  const parentId = n.parentKey ? m.nodes[n.parentKey].pageId : m.rootParentId;
  console.log(JSON.stringify({ key: n.key, title: n.title, parentId, bodyFile: writeBody(n.key) }, null, 2));
}

function writeBody(key: string): string {
  const n = readJson<Plan>(PLAN).nodes.find((x) => x.key === key);
  if (!n) throw new Error(`Unknown node: ${key}`);
  const file = join(mkdtempSync(join(tmpdir(), 'confluence-')), 'body.json');
  writeFileSync(file, JSON.stringify(n.body));
  return file;
}

function record(key: string, pageId: string, status: string, url: string) {
  if (status !== 'draft' && status !== 'current') throw new Error('status must be draft or current');
  writeJson(MANIFEST, recordNode(readJson<Manifest>(MANIFEST), key, { pageId, status, url }));
  console.log(`recorded ${key} → ${pageId} (${status})`);
}

const [cmd, ...args] = process.argv.slice(2);
(async () => {
  if (cmd === 'plan') await plan();
  else if (cmd === 'next') next();
  else if (cmd === 'body') console.log(writeBody(args[0]));
  else if (cmd === 'record') record(args[0], args[1], args[2], args[3] ?? '');
  else throw new Error('usage: plan | next | body <key> | record <key> <pageId> <draft|current> <url>');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
```

- [ ] **Step 5: Wire it up.**
  - In `backend/package.json` `scripts`, add `"confluence": "ts-node src/scripts/confluence-plan.ts"`.
  - Check that `GET /api/projects` returns `doc_mode`, `customer_facing` and `waivers` (it serializes via `serializeProject`): `grep -n serializeProject backend/src/routes/projects.ts`. If the list route doesn't, use `/api/projects/:id` per linked project in `plan()` instead.
  - Append to `.gitignore`:

```
docs/confluence/inventory/
docs/confluence/tree-plan.json
```

  - Create `docs/confluence/README.md`:

```markdown
# Confluence tree working files

- `inventory/inventory.json` (git-ignored): what Claude read from Confluence in the inventory task: space titles, H1'26 PRDs, canonical drafts and their roadmap mapping, legacy pages.
- `tree-plan.json` (git-ignored): every planned page with its ADF body. Rebuilt by `npm run confluence -- plan` (from `backend/`).
- `manifest.json` (committed): node key → page id, status (draft/current) and URL. Updated after every Confluence call with `npm run confluence -- record`. The doc check (build step 4) reads it to find hubs and roll-ups.
- `migration-list.md` (committed): moves, renames, adoptions, title conflicts and banners. Brice marks each row; only [x] rows are executed.

Rules: Atlassian MCP calls one at a time; drafts first; no write without Brice's approval; never link page 4286087221 to the WW On-Canvas item.
```

- [ ] **Step 6: Run tests and typecheck.** `cd backend && npx vitest run && npx tsc --noEmit -p .` → all pass, no type errors.

- [ ] **Step 7: Commit.**

```bash
git add shared/confluence-plan.ts backend/src/scripts/confluence-plan.ts backend/src/test/confluence-plan.test.ts backend/package.json .gitignore docs/confluence/README.md
git commit -m "feat(confluence): planning CLI and page manifest"
```

---

### Task 7: Confluence inventory (read-only)

**Goal:** `docs/confluence/inventory/inventory.json` holds what the plan needs from Confluence, read with one Atlassian call at a time and no writes.

**Files:** Create `docs/confluence/inventory/inventory.json` (git-ignored).

**Acceptance Criteria:**
- [ ] `cloudId` and `spaceId` (`221937685`) are set.
- [ ] `existing` lists every page and folder title in the space (paginate until done).
- [ ] `prdPages` lists the ~15 children of folder `3664740359` that are PRDs (Brice confirms which children count).
- [ ] The four drafts `4198498306`, `4226482184`, `4225269790`, `4225335315` are each either in `adopt` (roadmap item id → page id) or in `offRoadmap` (IDEA-845, IDEA-852), with Brice confirming every mapping. `adoptedTitles` has their current titles.
- [ ] `legacy` lists the H1'25 and H2'25 folder/pages and the old per-team canonical docs Brice wants bannered.
- [ ] No Atlassian write tool was called.

**Verify:** `node -e "const i=require('./docs/confluence/inventory/inventory.json'); console.log(i.existing.length, i.prdPages.length, Object.keys(i.adopt).length + i.offRoadmap.length)"` → a few hundred titles, ~15 PRDs, `4`.

**Steps (each bullet is one Atlassian call; wait for it before the next):**

- [ ] **Step 1: Refresh TaskManager's roadmap snapshot.** Roadmap MCP `list_roadmap_items { team: "Digital Products", includeSubteams: true, stage: "roadmap,build,measure,on-hold,wont-do" }`, then TaskManager `sync_roadmap { items }`. Don't link anything. Expect 22 items in roadmap/build/measure.
- [ ] **Step 2: Cloud ID.** `getAccessibleAtlassianResources` → the `minted.atlassian.net` id.
- [ ] **Step 3: Space titles.** `searchConfluenceUsingCql { cql: "space.id = 221937685 AND type in (page, folder)", limit: 250 }`; repeat with `cursor` until no `next`. If `space.id` isn't accepted, look up the space key with `getConfluenceSpaces` (one call) and use `space = <KEY>`. Keep `{ id, title }` only.
- [ ] **Step 4: H1'26 PRDs.** `getConfluencePageDescendants { pageId: "3664740359", depth: 1, limit: 250 }`. If folders aren't accepted, use CQL `parent = 3664740359`. Show Brice the list and ask which are PRDs. Put those in `prdPages`.
- [ ] **Step 5: The four canonical drafts.** For each of `4198498306`, `4226482184`, `4225269790`, `4225335315`, one `getConfluencePage { pageId, contentFormat: "adf" }` call. Save each body to `docs/confluence/inventory/<pageId>.adf.json`, for the adoption in Task 11. Note title and status.
- [ ] **Step 6: Map drafts to roadmap items.** Propose a mapping for each draft from its title and Jira key (`GET http://localhost:3001/api/roadmap` lists item ids, names and `jira_key`). The spec says IDEA-845 and IDEA-852 are not on the roadmap, so those two go to `offRoadmap` with their team. **Ask Brice to confirm each of the four.** Record `adopt`, `offRoadmap` and `adoptedTitles`.
- [ ] **Step 7: Legacy pages.** From the Step 3 titles, list the H1'25/H2'25 containers and old per-team canonical docs. Ask Brice which get a banner. Record `legacy`.
- [ ] **Step 8: Write `inventory.json`** with the `Inventory` shape from `shared/confluence-plan.ts`. Run the verify command.

---

### Task 8: Build the plan and get the migration list approved

**Goal:** Brice has reviewed the tree, the open decisions and every migration row, and their answers are recorded in `docs/confluence/migration-list.md`.

**Files:** Create `docs/confluence/manifest.json`, `docs/confluence/migration-list.md` (both by the CLI); `docs/confluence/tree-plan.json` (ignored).

**Acceptance Criteria:**
- [ ] `npm run confluence -- plan` succeeded; its counts are in the summary shown to Brice (~45 nodes, 22 hubs, collisions, migration rows).
- [ ] Brice answered: where `Roadmap Projects` goes (top level, or under which page → `rootParentId` in the manifest); the "Decisions this plan makes" list above; and each title collision.
- [ ] Every row in `migration-list.md` is marked `[x]` (approved) or `[-]` (skip), with Brice's edits applied (for example a different PRD match). `4286087221` is not `move_rename` to any WW hub.
- [ ] The approved list is committed.

**Verify:** `grep -c '| \[ \] |' docs/confluence/migration-list.md` → `0`.

**Steps:**

- [ ] **Step 1: Start the backend** if it isn't running (`./start.sh` or `cd backend && npm run dev`), then `cd backend && npm run confluence -- plan`.
- [ ] **Step 2: Show Brice the tree** (titles indented by parent, from `tree-plan.json`), the collisions and the decisions list. Ask about the root location. Set `rootParentId` in `manifest.json` from the answer.
- [ ] **Step 3: Walk the migration list** with Brice in chat, a section at a time: PRD moves, `leave` rows (ambiguous/unmatched/blocked), adoptions, off-roadmap hubs, collisions, banners. Mark each row as Brice says. If Brice re-matches a PRD, edit that row's `New title` and `New parent` by hand; never for `4286087221` → WW.
- [ ] **Step 4: Commit the approved list and manifest.**

```bash
git add docs/confluence/migration-list.md docs/confluence/manifest.json
git commit -m "docs(confluence): approved migration list and initial manifest"
```

---

### Task 9: Marker round-trip spike (one draft page)

**Goal:** Prove, on a single draft, that the Page Properties marker survives create → fetch → rewrite → fetch with hand-written content intact, and that a draft can be a parent of a draft. Decide `MARKER_STYLE`.

**Files:** Possibly modify `shared/confluence-adf.ts` (`MARKER_STYLE`) and re-run its tests.

**Acceptance Criteria:**
- [ ] Brice approved creating the test draft (and its child) before any call.
- [ ] After `updateConfluencePage` with a rewritten status section, a fresh `getConfluencePage` (ADF) shows the new status, the marker in the same form, and the hand-written Links paragraph unchanged.
- [ ] We know whether `createConfluencePage { status: "draft", parentId: <draft id> }` works.
- [ ] `MARKER_STYLE` is set to the form that round-tripped; tests pass.
- [ ] Brice has been asked to delete the two test drafts in the UI (Claude doesn't delete).

**Verify:** `cd backend && npx vitest run src/test/confluence-adf.test.ts src/test/confluence-hub.test.ts` → pass.

**Steps (one Atlassian call per bullet):**

- [ ] **Step 1: Ask Brice:** "OK to create two drafts, `[DP] Doc check marker test — Hub` and a child `[DP] Doc check marker test — child`, in space 221937685 to test markers? You'd delete them afterwards." Wait for yes.
- [ ] **Step 2:** `npm run confluence -- body hub:<any item key>` to get a hub body; `createConfluencePage { cloudId, spaceId: "221937685", title: "[DP] Doc check marker test — Hub", status: "draft", contentFormat: "adf", body: <file contents> }` (no `parentId`). If the ADF is rejected because of `bodiedExtension`, set `MARKER_STYLE = 'expand'`, re-run the tests, rebuild the body and retry once.
- [ ] **Step 3:** `createConfluencePage { …, title: "[DP] Doc check marker test — child", status: "draft", parentId: <id from step 2>, contentFormat: "adf", body: {"type":"doc","version":1,"content":[{"type":"paragraph","content":[{"type":"text","text":"child"}]}]} }`. Record whether a draft parent is accepted.
- [ ] **Step 4:** `getConfluencePage { pageId: <hub id>, contentFormat: "adf" }`. Check the marker node is present with its label (or title). Using a short `ts-node -e` script with `replaceGenerated`, replace the status section with `statusContent({...item, stage: 'measure'}, today)` and add a hand-written paragraph under Links.
- [ ] **Step 5:** `updateConfluencePage { pageId, status: "draft", contentFormat: "adf", body: <edited doc>, title: <same> }`.
- [ ] **Step 6:** `getConfluencePage` again (ADF). Confirm: one status marker, the new stage, the Links paragraph unchanged. Write the result into `docs/confluence/README.md` under "Marker spike" (what worked, which `MARKER_STYLE`, whether draft parents work).
- [ ] **Step 7:** Ask Brice to delete both test drafts in the Confluence UI.
- [ ] **Step 8: Commit** if anything changed:

```bash
git add shared/confluence-adf.ts docs/confluence/README.md
git commit -m "docs(confluence): marker spike results"
```

---

### Task 10: Scaffold the tree as drafts

**Goal:** Every planned page that isn't adopted exists as a draft in space `221937685`, recorded in the manifest.

**Files:** Modify `docs/confluence/manifest.json`.

**Acceptance Criteria:**
- [ ] Brice approved the batch with its count ("create N draft pages") before the first call.
- [ ] `npm run confluence -- next` prints "Nothing left to create."
- [ ] Every created page is `status: "draft"`, with the exact planned title and parent.
- [ ] No page was created twice: before each create whose previous attempt errored, a CQL title search confirmed the page didn't exist.
- [ ] If drafts can't parent drafts (Task 9), Brice chose one of the two fallbacks below before anything was published.

**Verify:** `node -e "const m=require('./docs/confluence/manifest.json'); const v=Object.values(m.nodes); console.log(v.filter(n=>!n.pageId).length, v.filter(n=>n.status==='draft').length)"` → `0` and the count of non-adopted nodes.

**Steps:**

- [ ] **Step 1: Re-run `npm run confluence -- plan`** so dates and statuses are today's, then tell Brice: "Ready to create N draft pages: 1 root, M structure pages, K hubs. Adopted pages are moved later, per the migration list. OK?" Wait for yes.
- [ ] **Step 2: If drafts can't parent drafts**, ask Brice to choose: (a) approve publishing the empty structure pages (root, Proposals, Not Pursued, Unscheduled, years, halves, team pages) as they are created, keeping hubs as drafts; or (b) create every page as a top-level draft and set parents when publishing in Task 13. Follow the choice.
- [ ] **Step 3: Loop, one page at a time:**
  1. `npm run confluence -- next` → key, title, parentId, bodyFile.
  2. `createConfluencePage { cloudId, spaceId: "221937685", title, parentId (omit if null), status: "draft", contentFormat: "adf", body: <contents of bodyFile> }`.
  3. `npm run confluence -- record <key> <id> draft <url from the response>`, **before** the next Atlassian call.
  4. If the call errors: run `searchConfluenceUsingCql { cql: 'space.id = 221937685 AND title = "<title>"' }` (escape quotes). If it exists, record it; if not, retry once. If it still fails, skip it (`next` will offer it again), note it, and move on. One failed page doesn't block the others.
- [ ] **Step 4: Report** the count created and any skipped. Commit the manifest:

```bash
git add docs/confluence/manifest.json
git commit -m "docs(confluence): scaffolded tree drafts"
```

---

### Task 11: Execute the approved migration

**Goal:** Every `[x]` row in the migration list has been carried out, one call at a time; `[-]` rows are untouched.

**Files:** Modify `docs/confluence/manifest.json`, `docs/confluence/migration-list.md` (a `Done` note per row).

**Acceptance Criteria:**
- [ ] Only `[x]` rows ran. Each row's result (done, or failed with the reason) is noted in `migration-list.md`.
- [ ] Moved PRDs keep their page IDs and get their new title and parent.
- [ ] Adopted drafts are in the team space under their planned parent, titled as the hub, with the hub template body and their original content under "Background (from the original page)". Off-roadmap hubs show the off-roadmap panel.
- [ ] `4286087221` was not moved under any WW hub.
- [ ] No body was sent that wasn't fetched in the same row's steps (hard rule 7).

**Verify:** For three sampled rows, `getConfluencePage` shows the new title and parent. `grep -c 'Done' docs/confluence/migration-list.md` = number of `[x]` rows.

**Steps (one Atlassian call per numbered item; record after each):**

- [ ] **Step 1: Confirm before starting:** "Executing the N approved rows in docs/confluence/migration-list.md now, one at a time. OK?" Wait for yes.
- [ ] **Step 2: `move_rename` (PRDs).** For each row:
  1. `getConfluencePage { pageId, contentFormat: "adf" }`.
  2. If the ADF has a `com.atlassian.confluence.migration` extension, stop that row: note "Move in UI" and ask Brice to drag it under the hub and rename it to the new title.
  3. Otherwise `updateConfluencePage { pageId, title: <new title>, parentId: <manifest page id of newParentKey>, contentFormat: "adf", body: <the ADF just fetched, unchanged>, status: <current status of the page>, versionMessage: "Moved into Roadmap Projects tree" }`.
  4. Note "Done" on the row.
- [ ] **Step 3: `adopt_as_hub` and `off_roadmap_hub`.** For each row:
  1. `getConfluencePage { pageId, contentFormat: "adf" }` (fresh, not the inventory copy).
  2. Build the body with `renderHubDoc({ item, rows, today, settings, offRoadmap, adoptedContent: fetched.content })` (a short `ts-node -e` script using the plan's item and rows for that hub key).
  3. Show Brice the first lines of the new body and ask: "Replace this draft's body with the hub template, keeping your text under Background?" Wait for yes.
  4. `updateConfluencePage { pageId, spaceId: "221937685", parentId: <manifest id of newParentKey>, title: <hub title>, contentFormat: "adf", body, status: "draft" }`. If moving a draft across spaces is refused, create the hub as a new draft in the team space by hand (`next` skips adopted hubs, so call `createConfluencePage` with the body you just built, `status: "draft"` and the parent from the manifest), record it with `npm run confluence -- record <hub key> <new id> draft <url>`, and ask Brice to delete the personal draft in the UI.
  5. `npm run confluence -- record <hub key> <pageId> draft <url>` and note "Done".
- [ ] **Step 4: `rename_conflict`.** For pages: fetch ADF, then `updateConfluencePage` with the new title and the unchanged body. For folders (the update is refused): ask Brice to rename the folder in the UI. Then re-run `npm run confluence -- next` and create any node that was blocked by the collision.
- [ ] **Step 5: `banner`.** For each: fetch ADF, prepend `panel('info', [p(text(BANNER_TEXT))])`, then `updateConfluencePage` with the same title and status. Never touch the rest of the body.
- [ ] **Step 6: Commit.**

```bash
git add docs/confluence/manifest.json docs/confluence/migration-list.md
git commit -m "docs(confluence): executed approved migration rows"
```

---

### Task 12: Hub URLs back into TaskManager

**Goal:** Linked projects carry their hub URL, so `get_doc_health` shows the hub row and clears the `no_hub` flag. Unlinked items keep their hub in the manifest until their project exists.

**Files:** none in the repo (TaskManager data via MCP).

**Acceptance Criteria:**
- [ ] Brice confirmed each `link_project` call before it was made.
- [ ] IDEA-850 (`oi-4`) and IDEA-932 (`id-1773091064966-jyqedxkup`) have `hub_url` set to their hub's URL from the manifest. Existing waivers were not dropped (`link_project` without `waivers` leaves them alone).
- [ ] `get_doc_health { project_id }` shows the hub row as 📝 Draft while the hub is a draft (a `draftId=`/`resumedraft.action` URL), and the `no_hub` flag is gone.
- [ ] The other 20 hubs are listed for Brice as "hub ready, no TaskManager project yet"; none is created or linked in bulk.

**Verify:** `get_doc_health` for both projects → hub row present, flags exclude `no_hub`.

**Steps:**

- [ ] **Step 1:** Read `manifest.json` for `hub:oi-4` and `hub:id-1773091064966-jyqedxkup`. Find each project id with `list_projects`.
- [ ] **Step 2:** Ask Brice: "Set hub_url on IDEA-850 → <url> and IDEA-932 → <url>?" On yes, `link_project { project_id, hub_url }` for each, one at a time.
- [ ] **Step 3:** `get_doc_health { project_id }` for each and show Brice the hub row and flags.
- [ ] **Step 4:** Give Brice the list of the other hubs (title, URL, roadmap item) as candidates for project creation. For each one Brice approves later: `create_project`, then `link_project { project_id, roadmap_item_id, docs_stage: "roadmap", team, hub_url, waivers: { one_pager: "predates system" } (build/measure only) }`.

---

### Task 13: Publish, with approval

**Goal:** Pages Brice approves are published, parents before children, and TaskManager hub URLs switch to the published URLs.

**Files:** Modify `docs/confluence/manifest.json`.

**Acceptance Criteria:**
- [ ] Brice approved a named set ("all structure pages", "these hubs", or "everything") before the first publish call.
- [ ] Pages were published parents first. Every published page has `status: "current"` in the manifest and its published URL.
- [ ] Linked projects' `hub_url` was updated to the published URL (with Brice's yes), and `get_doc_health` shows the hub row ✅ Done.
- [ ] Nothing outside the approved set was published.

**Verify:** `get_doc_health` for IDEA-850 and IDEA-932 → hub `done`. Manifest `status` is `current` for exactly the approved set.

**Steps:**

- [ ] **Step 1: Ask Brice** what to publish now: all structure pages, which hubs, or everything. Wait for the answer.
- [ ] **Step 2: For each approved page, in manifest (= plan) order, one call at a time:**
  1. `getConfluencePage { pageId, contentFormat: "adf" }`.
  2. `updateConfluencePage { pageId, title: <same>, contentFormat: "adf", body: <fetched ADF>, status: "current", versionMessage: "Published Roadmap Projects tree" }` (and `parentId` if Task 10 used fallback (b)).
  3. `npm run confluence -- record <key> <pageId> current <published URL>`.
- [ ] **Step 3: Update TaskManager.** Ask Brice, then `link_project { project_id, hub_url: <published URL> }` for each linked project whose hub was published. Check `get_doc_health`.
- [ ] **Step 4: Commit and hand over.**

```bash
git add docs/confluence/manifest.json
git commit -m "docs(confluence): published approved pages"
```

Then leave a note in the shared session notes folder for the step-4 plan: where the manifest is, the marker style chosen, which hubs are still drafts, and any rows Brice moved by hand.

---

## Spec coverage check

| Spec item | Task |
|---|---|
| §3 tree: Roadmap Projects → Year → Half → Team → Hub; Proposals, Not Pursued, Unscheduled by team | 2, 6, 10 |
| §3 every level is a page; team space 221937685 | 2, 10 |
| §3 titles unique per space; team prefixes OI/WW/ABK/DP; name trimmed | 2 (collisions in 6, 8, 11) |
| §3 hub sections: generated Status and Doc checklist between fixed markers; Links, Decisions log, Open questions, Settings hand-written | 1, 3, 9 |
| §3 roll-ups with generated grids | 3 (placeholder section; filled by step 4) |
| §3 hubs for every in-scope item in one batch, including empty ones | 6, 10 |
| §3 migration: H1'26 PRDs move under hubs and are renamed, IDs kept | 5, 8, 11 |
| §3 four personal drafts become hubs; IDEA-845/852 → Unscheduled, off-roadmap | 5, 7, 11 |
| §3 H1'25/H2'25 and old canonical docs stay, with a pointer banner | 5, 11 |
| §3 build/measure items without a one-pager: `one_pager` waived "predates system" | 3 (`defaultSettings`), 12 |
| §1 decision block: Go / No-go / Parked, date, reason; Parked needs revisit-by | 4 |
| Decisions: moves and renames listed for approval first | 5, 8, 11 |
| §5 Confluence calls strictly one at a time; failed write retried, doesn't block others | Hard rules, 10, 11 |
| §5 idempotent; generated sections fully replaced; hand-written never touched | 1, 6 (manifest), 9 |
| §5 unknown data shows ❓ | 3 |
| `link_project` with `hub_url` | 12, 13 |
| Never link `4286087221` to WW On-Canvas | Hard rules, 5 |

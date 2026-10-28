# Daily Doc Check and Morning Briefing Rework Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers-extended-cc:subagent-driven-development (if subagents available) or superpowers-extended-cc:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every weekday morning the briefing runs one doc check. It records doc pages found under each hub in TaskManager, rewrites the generated sections of hubs and roll-ups that changed, and adds a **Docs** section to the briefing. The briefing stops doing the things the doc system now owns (doc due dates, canonical page health, the IDEA mapping file).

**Architecture:**
- **One deterministic CLI does the doc check:** `npm run doc-check -- run [--write]`. It reads the TaskManager API (local) and Confluence (REST API, with a token from the macOS Keychain). It computes everything with pure functions in `shared/`, then (only with `--write`) applies evidence to TaskManager and replaces the generated sections of pages whose content changed. It prints the briefing's Docs section as Markdown.
- **Why a CLI with its own token, not the Atlassian MCP:** updating a page through the MCP means Claude re-sending the whole page body, copied by hand from a tool result. That is unreliable for big pages, and expensive on API billing. The CLI fetches, splices and writes the ADF itself, so no body ever passes through the model. The MCP connector's concurrency bug is server-side in the MCP, so the REST API doesn't have it. The CLI still makes its calls one at a time.
- **The briefing calls it once:** after Agent A (the only Atlassian MCP agent) has returned, the main context syncs the roadmap (roadmap MCP → `sync_roadmap`), then runs the CLI in one Bash call and pastes its Markdown into the briefing.

**Tech Stack:** TypeScript (shared, backend), Vitest, ts-node, Confluence Cloud REST API v2 (`/wiki/api/v2/pages`), macOS `security` (Keychain), TaskManager REST API, roadmap MCP + TaskManager MCP (`sync_roadmap`) inside the scheduled briefing.

**Spec:** `docs/superpowers/specs/2026-10-28-project-docs-system-design.md` §5 (the doc check), §2 (evidence rules), §3 (hub and roll-up sections). This is build-order **step 4**. Steps 1–3 are done and merged (PR bricefengerminted/TaskManager#1, #2).

**Out of scope:** the proposals flow (step 5: matching proposals to new roadmap items, moving one-pagers under hubs); roadmap link write-back (step 6); hosting or backups.

---

## Hard rules for whoever executes this plan

1. **Dry run first, always.** `run` without `--write` changes nothing. The first `--write` on live data happens only after Brice has read a dry-run report (Task 8).
2. **Only generated sections are ever written.** The CLI replaces the content of a `doc-check-*` Page Properties macro and nothing else. A page whose marker is missing or duplicated is skipped and reported, never "fixed".
3. **Confluence calls run one at a time.** That covers both the CLI's REST calls (a sequential queue) and any MCP calls you make while executing this plan.
4. **No credentials typed by Claude.** Brice creates the Atlassian API token and stores it in the Keychain himself (Task 0). Code reads it; nobody prints it.
5. **Never link the OI On-Canvas PRD (`4286087221`) to a WW item.** The evidence step reuses `NEVER_LINK` from `shared/confluence-migration.ts`.
6. **The briefing's SKILL.md lives outside the repo.** Show Brice the full diff of `~/.claude/scheduled-tasks/daily-morning-briefing/SKILL.md` before saving it (Task 9), and keep a dated copy of the old file.

## Decisions (recommended defaults; Brice confirms in Task 0)

- **D1 — The doc check gets its own Confluence API token** (Keychain service `taskmanager-confluence`). This changes the spec's "backend holds no external credentials": the *server* still holds none, only the CLI reads the token. The alternative, writing hubs through the MCP, is not planned, for the reasons under Architecture.
- **D2 — Dates come from the roadmap tool for doc tasks (unchanged) and for lifecycle tasks (changed).** Today the briefing re-dates lifecycle tasks from Jira's Build Start / Release custom fields, while doc tasks are dated from roadmap.mntd.net phases. The two already disagree: Photo/Video's Build start is 2026-11-01 in Jira but 2026-11-11 in the roadmap tool. Recommendation: the roadmap tool is the one source (it is the spec's system of record). The briefing's timeline sync then compares Jira with the roadmap tool and *reports* drift instead of writing dates from Jira. If Brice prefers Jira, Task 9 keeps the Jira read and only adds the doc-task exclusion.
- **D3 — Finding doc pages under a hub.** Brice kept original titles when he moved briefs ("Print Upsell - Matching Accessories"), so the spec's "title ends in the doc label" rule finds almost nothing. Rule used instead:
  1. A page already recorded as evidence stays recorded.
  2. A child whose title ends in ` — <Doc label>` (the template title) is recorded automatically.
  3. Any other unrecorded child is **classified by keywords** (experiment, release notes, one-pager, metrics, research, CS/Marketing, PRD/brief) and listed in the briefing as "Looks like <doc> — confirm". Nothing is recorded until Brice confirms (`npm run doc-check -- accept …`).
  4. A child that matches nothing is listed once as "Unclassified page under hub", then ignored (kept in `docs/confluence/doc-check-ignore.json`).
- **D4 — TaskManager owns hub settings** (doc mode, customer-facing, waivers). The hub's Settings table becomes a fourth generated section, `doc-check-settings`, and its intro changes to "Change these in TaskManager". Today the table says "Edit the Value column", but nothing reads it, and waivers already live in TaskManager. One-time migration in Task 6.
- **D5 — Only changed sections are written.** The CLI compares the new section content with what is on the page, ignoring Confluence-added IDs. An unchanged page costs one GET and no PUT. A normal day writes a handful of pages, not 45.
- **D6 — The experiment brief's Results.** `results_filled` is true when the page has a heading containing "Results" followed by at least 20 characters of non-template text before the next heading. Only checked for pages recorded as `experiment_brief.*` evidence.

## File map

| File | Responsibility |
|---|---|
| `shared/confluence-adf.ts` (modify) | add the `settings` generated section; `normalizeForCompare()`; `sectionContent()` |
| `shared/doc-evidence.ts` (create) | classify hub children into doc keys; Results detection |
| `shared/confluence-rollup.ts` (create) | roll-up grid content; settings section content |
| `shared/doc-check-run.ts` (create) | the pure core: inputs → evidence, proposals, page writes, flags, Markdown |
| `backend/src/lib/confluence-rest.ts` (create) | sequential Confluence REST client; Keychain token |
| `backend/src/scripts/doc-check.ts` (create) | CLI: `run [--write]`, `accept`, `ignore`, `migrate-settings [--write]` |
| `backend/package.json` (modify) | `"doc-check"` script |
| `.gitignore` (modify) | `docs/confluence/state/` (daily run logs) |
| `docs/confluence/doc-check-ignore.json` (create) | pages Brice marked "not a doc" |
| `docs/confluence/README.md` (modify) | token setup and runbook |
| `backend/src/test/doc-evidence.test.ts`, `confluence-rollup.test.ts`, `doc-check-run.test.ts`, `confluence-rest.test.ts` (create) | tests |
| `~/.claude/scheduled-tasks/daily-morning-briefing/SKILL.md` (outside repo) | briefing rework |
| `~/Claude Assistant/.claude/skills/draft-deliverables/SKILL.md`, `knowledge/project-lifecycle-template.md`, `state/project-timelines.md` (outside repo) | point at hubs; drop matrix rows; retire the mapping |

---

### Task 0: Confirm decisions and set up the token

**Goal:** Brice has confirmed D1–D6 and the token is in the Keychain.

**Files:**
- Modify: `docs/confluence/README.md`

**Acceptance Criteria:**
- [ ] Brice's answers to D1–D6 are recorded in the README (one line each, with the date).
- [ ] `security find-generic-password -s taskmanager-confluence -w >/dev/null && echo ok` prints `ok`.

**Verify:** `security find-generic-password -s taskmanager-confluence -a "$CONFLUENCE_EMAIL" >/dev/null && echo ok` → `ok`

**Steps:**

- [ ] **Step 1: Ask Brice to confirm D1–D6** in chat. Change the plan where he disagrees before doing anything else. D2 changes Task 9, D3 changes Task 2, D4 changes Task 6.
- [ ] **Step 2: Brice creates the token himself.** He goes to id.atlassian.com → Security → API tokens → Create, names it `taskmanager-doc-check`, then runs this in his own terminal (it prompts for the token, so it never lands in shell history):

```bash
security add-generic-password -s taskmanager-confluence -a brice.fenger@minted.com -w
```

- [ ] **Step 3: Add to `docs/confluence/README.md`:**

```markdown
## Doc check (step 4)

- Token: Keychain service `taskmanager-confluence`, account = your Atlassian email. Created by Brice; rotate at id.atlassian.com.
- The CLI reads `CONFLUENCE_EMAIL` (default `brice.fenger@minted.com`) and `CONFLUENCE_BASE` (default `https://minted.atlassian.net`).
- Dry run: `npm --prefix backend run doc-check -- run`
- Write: `npm --prefix backend run doc-check -- run --write`
- Confirm a proposed doc: `npm --prefix backend run doc-check -- accept <projectId> <doc_key> <pageId>`
- Not a doc: `npm --prefix backend run doc-check -- ignore <pageId>`

Decisions (Brice, <date>): D1 … D6 …
```

- [ ] **Step 4: Commit**

```bash
git add docs/confluence/README.md
git commit -m "docs(doc-check): decisions and token setup"
```

---

### Task 1: ADF helpers for the settings section and change detection

**Goal:** `confluence-adf.ts` knows a fourth generated section and can tell whether a section's content actually changed.

**Files:**
- Modify: `shared/confluence-adf.ts`
- Test: `backend/src/test/confluence-adf.test.ts` (extend)

**Acceptance Criteria:**
- [ ] `GENERATED.settings` exists with label `doc-check-settings`.
- [ ] `sectionContent(doc, section)` returns the content after the "Generated by…" note, or `null` when the marker is missing or duplicated.
- [ ] `normalizeForCompare()` drops `localId`, `macroId`, `_parentId` and `__confluenceMetadata` at any depth, so a page Confluence round-tripped compares equal to what we generated.

**Verify:** `cd backend && npx vitest run src/test/confluence-adf.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Write the tests** (append to `backend/src/test/confluence-adf.test.ts`):

```ts
import { doc, generated, p, text, sectionContent, normalizeForCompare, GENERATED } from '../../../shared/confluence-adf';

describe('settings section and change detection', () => {
  it('has a settings marker', () => {
    expect(GENERATED.settings.label).toBe('doc-check-settings');
  });

  it('reads a section back without the note', () => {
    const d = doc([generated('status', [p(text('hello'))])]);
    expect(sectionContent(d, 'status')).toEqual([p(text('hello'))]);
    expect(sectionContent(d, 'checklist')).toBeNull();
  });

  it('ignores ids Confluence adds', () => {
    const ours = [p(text('a'))];
    const theirs = [{ type: 'paragraph', attrs: { localId: 'x1' }, content: [{ type: 'text', text: 'a' }] }];
    expect(normalizeForCompare(theirs)).toEqual(normalizeForCompare(ours));
  });
});
```

- [ ] **Step 2: Run them and watch them fail** (`sectionContent`, `normalizeForCompare` and `GENERATED.settings` don't exist).

- [ ] **Step 3: Implement** in `shared/confluence-adf.ts`:

```ts
export type GeneratedSection = 'status' | 'checklist' | 'rollup' | 'settings';

export const GENERATED: Record<GeneratedSection, { label: string; title: string }> = {
  status: { label: 'doc-check-status', title: 'Status — generated by the doc check' },
  checklist: { label: 'doc-check-checklist', title: 'Doc checklist — generated by the doc check' },
  rollup: { label: 'doc-check-rollup', title: 'Roll-up — generated by the doc check' },
  settings: { label: 'doc-check-settings', title: 'Settings — generated by the doc check' },
};

/** A section's content without the leading "Generated by…" note; null when missing or duplicated. */
export function sectionContent(d: AdfDoc, section: GeneratedSection): AdfNode[] | null {
  const at = findGenerated(d, section);
  if (at.length !== 1) return null;
  const body = d.content[at[0]].content ?? [];
  return body.length && adfText(body[0]) === NOTE ? body.slice(1) : body;
}

const VOLATILE = new Set(['localId', 'macroId', '_parentId', '__confluenceMetadata']);

/** Strip ids Confluence adds on save, and empty attrs, so two bodies compare by meaning. */
export function normalizeForCompare(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalizeForCompare);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (VOLATILE.has(k)) continue;
      const n = normalizeForCompare(val);
      if (k === 'attrs' && n && typeof n === 'object' && Object.keys(n).length === 0) continue;
      out[k] = n;
    }
    return out;
  }
  return v;
}
```

- [ ] **Step 4: Run all tests** (`cd backend && npx vitest run`). They pass, and `npx tsc --noEmit -p .` is clean.
- [ ] **Step 5: Commit**

```bash
git add shared/confluence-adf.ts backend/src/test/confluence-adf.test.ts
git commit -m "feat(doc-check): settings section and change detection helpers"
```

---

### Task 2: Classifying pages under a hub

**Goal:** Given a hub's child pages and what is already recorded, decide which children become evidence, which are proposals, and which are ignored.

**Files:**
- Create: `shared/doc-evidence.ts`
- Test: `backend/src/test/doc-evidence.test.ts`

**Acceptance Criteria:**
- [ ] A title ending in ` — Brief/PRD` (any team prefix) maps to `prd` with confidence `exact`.
- [ ] "Experiment Brief: OI Messaging Center" maps to `experiment_brief.plan` as a `guess`. "Print Upsell - Matching Accessories" maps to nothing.
- [ ] Keyword order: experiment before brief, so an experiment brief is never classified as a PRD.
- [ ] `resultsFilled()` is false for a template-only Results section and true for real text.
- [ ] Pages in the `NEVER_LINK` table are never proposed for the item they're barred from.

**Verify:** `cd backend && npx vitest run src/test/doc-evidence.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Write the tests**

```ts
import { describe, it, expect } from 'vitest';
import { classifyTitle, resultsFilled } from '../../../shared/doc-evidence';
import { doc, h, p, text } from '../../../shared/confluence-adf';

describe('classifyTitle', () => {
  it('matches template titles exactly', () => {
    expect(classifyTitle('[WW] Modular Elements — Brief/PRD')).toEqual({ key: 'prd', confidence: 'exact' });
    expect(classifyTitle('[OI] Guest RSVP Iteration — Release Notes')).toEqual({ key: 'release_notes', confidence: 'exact' });
  });
  it('guesses from keywords', () => {
    expect(classifyTitle('Experiment Brief: OI Messaging Center')).toEqual({ key: 'experiment_brief.plan', confidence: 'guess' });
    expect(classifyTitle('Adult Child/Maybe Experimentation Doc')).toEqual({ key: 'experiment_brief.plan', confidence: 'guess' });
    expect(classifyTitle('Brief/PRD: Upload Your Own Design — Online Invitations')).toEqual({ key: 'prd', confidence: 'guess' });
    expect(classifyTitle('PRD: Modular Home Page Elements for Wedding Websites')).toEqual({ key: 'prd', confidence: 'guess' });
  });
  it('returns null when nothing matches', () => {
    expect(classifyTitle('Print Upsell - Matching Accessories')).toBeNull();
    expect(classifyTitle('Cash Registry Transition: Birdie → Stripe')).toBeNull();
  });
  it('skips pages marked deprecated', () => {
    expect(classifyTitle('OLD DEPRECATED PRD: Photo/Video Enhancements for Wedding Websites')).toBeNull();
  });
});

describe('resultsFilled', () => {
  it('needs real text under a Results heading', () => {
    const template = doc([h(2, 'Results'), p(text('Outcome vs. success criteria:')), h(2, 'Next')]);
    const filled = doc([h(2, 'Results'), p(text('Completion up 2.1% vs control at 95% confidence; shipping.')), h(2, 'Next')]);
    expect(resultsFilled(template)).toBe(false);
    expect(resultsFilled(filled)).toBe(true);
    expect(resultsFilled(doc([h(2, 'Hypothesis'), p(text('x'.repeat(50)))]))).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Implement `shared/doc-evidence.ts`**

```ts
// Which doc a page under a hub is. Spec §2 "Evidence a doc exists", adapted per plan D3:
// exact template titles are recorded automatically; keyword guesses wait for Brice.

import { DOC_MATRIX, type DocKey } from './doc-matrix';
import { adfText, type AdfDoc } from './confluence-adf';

export interface Classification {
  key: DocKey;
  confidence: 'exact' | 'guess';
}

// Order matters: the first match wins, so experiment comes before brief/PRD.
const KEYWORDS: [RegExp, DocKey][] = [
  [/experiment/i, 'experiment_brief.plan'],
  [/release notes/i, 'release_notes'],
  [/one[- ]?pager/i, 'one_pager'],
  [/metrics snapshot|2[- ]week metrics/i, 'metrics_snapshot'],
  [/research synthesis|\buxr\b/i, 'research'],
  [/cs\s*\/\s*marketing/i, 'cs_marketing_brief'],
  [/\bprd\b|\bbrief\b/i, 'prd'],
];

const SKIP = /\b(deprecated|archived?|old)\b/i;

export function classifyTitle(title: string): Classification | null {
  const t = title.trim();
  if (SKIP.test(t)) return null;
  for (const row of DOC_MATRIX) {
    if (row.key === 'hub' || row.linkOnly) continue;
    if (t.endsWith(` — ${row.pageTitle}`)) return { key: row.key, confidence: 'exact' };
  }
  for (const [re, key] of KEYWORDS) if (re.test(t)) return { key, confidence: 'guess' };
  return null;
}

const MIN_RESULTS_CHARS = 20;
const TEMPLATE_LINE = /^(outcome vs\.? success criteria:?|decision:?\s*(ship\s*\/\s*iterate\s*\/\s*kill)?|date:?)$/i;

/** True when a heading containing "Results" is followed by real text before the next heading. */
export function resultsFilled(d: AdfDoc): boolean {
  const nodes = d.content;
  const start = nodes.findIndex((n) => n.type === 'heading' && /results/i.test(adfText(n)));
  if (start < 0) return false;
  let chars = 0;
  for (const n of nodes.slice(start + 1)) {
    if (n.type === 'heading') break;
    const line = adfText(n).trim();
    if (!line || TEMPLATE_LINE.test(line)) continue;
    chars += line.length;
  }
  return chars >= MIN_RESULTS_CHARS;
}
```

Before writing the code, check that every `pageTitle` in `DOC_MATRIX` (`shared/doc-matrix.ts`) is the suffix the step-3 templates used: `docPageTitle` in `shared/confluence-tree.ts` builds `[XX] <name> — <pageTitle>`.

- [ ] **Step 4: Run all tests and tsc.** Both clean.
- [ ] **Step 5: Commit**

```bash
git add shared/doc-evidence.ts backend/src/test/doc-evidence.test.ts
git commit -m "feat(doc-check): classify hub children and detect filled Results"
```

---

### Task 3: Roll-up grids and the settings section content

**Goal:** Pure functions that build the content of roll-up pages and the hub settings section.

**Files:**
- Create: `shared/confluence-rollup.ts`
- Test: `backend/src/test/confluence-rollup.test.ts`

**Acceptance Criteria:**
- [ ] `rollupContent(rows)` renders a table with one row per hub (Project, Stage, then one status cell per doc key that is active on any row), overdue projects first, then by name.
- [ ] Each project name links to its hub URL.
- [ ] An empty roll-up renders "No projects here yet."
- [ ] `settingsContent(settings)` renders the same three rows as the step-3 `settingsTable`, plus a note "Change these in TaskManager (Docs panel) or ask Claude."

**Verify:** `cd backend && npx vitest run src/test/confluence-rollup.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Write the tests**

```ts
import { describe, it, expect } from 'vitest';
import { rollupContent, settingsContent, type RollupRow } from '../../../shared/confluence-rollup';
import { adfText, doc } from '../../../shared/confluence-adf';

const row = (name: string, statuses: Record<string, string>, overdue = 0): RollupRow => ({
  name, hubUrl: `https://minted.atlassian.net/wiki/spaces/PM/pages/${name.length}`, stage: 'build',
  cells: statuses as RollupRow['cells'], overdue,
});

describe('rollupContent', () => {
  it('puts overdue projects first', () => {
    const t = adfText(doc(rollupContent([row('B project', { prd: 'done' }), row('A project', { prd: 'overdue' }, 1)])));
    expect(t.indexOf('A project')).toBeLessThan(t.indexOf('B project'));
  });
  it('handles an empty page', () => {
    expect(adfText(doc(rollupContent([])))).toContain('No projects here yet.');
  });
});

describe('settingsContent', () => {
  it('shows waivers and the TaskManager note', () => {
    const t = adfText(doc(settingsContent({ doc_mode: 'full', customer_facing: false, waivers: { one_pager: 'predates system' } })));
    expect(t).toContain('one_pager — predates system');
    expect(t).toContain('Change these in TaskManager');
  });
});
```

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Implement `shared/confluence-rollup.ts`**

```ts
// Roll-up grids (root, year, half, team, Proposals, Not Pursued, Unscheduled) and the hub
// settings section. Spec §3 "Roll-ups"; plan D4.

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
  const keys = DOC_MATRIX.map((r) => r.key).filter((k) =>
    rows.some((r) => r.cells[k] && r.cells[k] !== 'inactive'));
  const sorted = [...rows].sort((a, b) => b.overdue - a.overdue || a.name.localeCompare(b.name));
  return [table(
    ['Project', 'Stage', ...keys.map((k) => DOC_MATRIX.find((r) => r.key === k)!.label)],
    sorted.map((r) => [
      [r.hubUrl ? link(r.name, r.hubUrl) : text(r.name)],
      [text(r.stage ?? '—')],
      ...keys.map((k) => [text(r.cells[k] ? STATUS_LABEL[r.cells[k]!] : '—')]),
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
      [[text('waivers')], [text(waivers.length ? waivers.map(([k, why]) => `${k} — ${why}`).join('; ') : 'none')]],
    ]),
  ];
}
```

- [ ] **Step 4: Run all tests and tsc.** Both clean.
- [ ] **Step 5: Commit**

```bash
git add shared/confluence-rollup.ts backend/src/test/confluence-rollup.test.ts
git commit -m "feat(doc-check): roll-up grid and settings section content"
```

---

### Task 4: The pure doc-check core

**Goal:** One function turns a snapshot of Confluence plus TaskManager into everything the CLI needs to do.

**Files:**
- Create: `shared/doc-check-run.ts`
- Test: `backend/src/test/doc-check-run.test.ts`

**Acceptance Criteria:**
- [ ] Hubs map to projects by the page id in `project.hub_url`, falling back to the manifest key `hub:<roadmap_item_id>`.
- [ ] An `exact` child becomes evidence (`page_url`, `published` from page status). A `guess` becomes a proposal. A recorded page is never re-proposed. A page in the ignore list is skipped.
- [ ] For each hub, three section writes are produced: `status`, `checklist` and `settings`. For a hub with no TaskManager project, the checklist comes from `itemDocRows()`, the same as at creation.
- [ ] For each roll-up page in the manifest, one `rollup` write is produced. Its rows are the hubs that are descendants of that page in the Confluence tree.
- [ ] Flags: `no_hub` (roadmap project with no hub), `wrong_half` (the hub's half ancestor doesn't match `dev_start_half`), `unclassified` (new child, no match). Mismatch flags come from the health rows.
- [ ] `markdown` lists overdue docs, docs due within 7 days, proposals, then flags. It ends with a line counting pages written, unchanged and skipped (filled in by the CLI).

**Verify:** `cd backend && npx vitest run src/test/doc-check-run.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Write the tests.** Use a small fixture:
  - a root page, a half page `H2'26` and a team-half page `H2'26 · Online Invites`;
  - hub `h1`, mapped to project `p1` by `hub_url`;
  - hub `h2`, with no project;
  - children of `h1`: `[OI] X — Brief/PRD` (current), "Experiment Brief: X" (current) and "Notes" (current).

```ts
import { describe, it, expect } from 'vitest';
import { planDocCheck, type DocCheckInput } from '../../../shared/doc-check-run';

const page = (id: string, title: string, parentId: string, status: 'current' | 'draft' = 'current') => ({ id, title, parentId, status });
const base = 'https://minted.atlassian.net/wiki/spaces/PM/pages/';

function fixture(over: Partial<DocCheckInput> = {}): DocCheckInput {
  return {
    today: '2026-10-28',
    base,
    tree: [
      page('root', 'Roadmap Projects', 'x'), page('half', "H2'26", 'root'), page('team', "H2'26 · Online Invites", 'half'),
      page('h1', '[OI] X — Hub', 'team'), page('h2', '[OI] Y — Hub', 'team'),
      page('c1', '[OI] X — Brief/PRD', 'h1'), page('c2', 'Experiment Brief: X', 'h1'), page('c3', 'Notes', 'h1'),
    ],
    manifest: { 'root': 'root', 'half:2026-H2': 'half', 'team_half:2026-H2:OI': 'team', 'hub:item-1': 'h1', 'hub:item-2': 'h2' },
    projects: [{ project_id: 'p1', name: '[IDEA-1] X', roadmap_item_id: 'item-1', hub_url: `${base}h1`, half: '2026-H2',
      roadmap_stage: 'build', docs_stage: 'roadmap', decision: null, team: 'OI', flags: [],
      rows: [{ key: 'prd', label: 'Brief/PRD', phase: 'ux', due: '2026-10-01', due_rule: 'Build start −2w', needs: [], status: 'overdue', mismatch: false, link: null }],
      settings: { doc_mode: 'full', customer_facing: false, waivers: {} } }],
    items: [
      { id: 'item-1', name: 'X', team_name: 'Online Invites', stage: 'build', status: 'on-track', pm_name: null, jira_key: 'IDEA-1', first_seen_at: '2026-10-28', phases: {}, links: {}, dev_start_half: '2026-H2' },
      { id: 'item-2', name: 'Y', team_name: 'Online Invites', stage: 'roadmap', status: 'on-track', pm_name: null, jira_key: 'IDEA-2', first_seen_at: '2026-10-28', phases: {}, links: {}, dev_start_half: '2026-H2' },
    ],
    recordedPageIds: {},
    ignored: [],
    ...over,
  };
}

describe('planDocCheck', () => {
  it('records exact matches and proposes guesses', () => {
    const out = planDocCheck(fixture());
    expect(out.evidence.p1.prd).toEqual({ page_url: `${base}c1`, published: true });
    expect(out.proposals).toEqual([expect.objectContaining({ project_id: 'p1', page_id: 'c2', key: 'experiment_brief.plan' })]);
    expect(out.flags).toContainEqual(expect.objectContaining({ kind: 'unclassified', page_id: 'c3' }));
  });

  it('does not re-propose recorded or ignored pages', () => {
    const out = planDocCheck(fixture({ recordedPageIds: { c2: { project_id: 'p1', key: 'experiment_brief.plan' } }, ignored: ['c3'] }));
    expect(out.proposals).toEqual([]);
    expect(out.flags.find((f) => f.kind === 'unclassified')).toBeUndefined();
  });

  it('writes hub sections for hubs with and without a project, and the roll-ups', () => {
    const out = planDocCheck(fixture());
    const ids = out.writes.map((w) => `${w.page_id}:${w.section}`);
    expect(ids).toEqual(expect.arrayContaining(['h1:status', 'h1:checklist', 'h1:settings', 'h2:checklist', 'root:rollup', 'half:rollup', 'team:rollup']));
  });

  it('flags a hub filed under the wrong half', () => {
    const out = planDocCheck(fixture({ items: fixture().items.map((i) => (i.id === 'item-1' ? { ...i, dev_start_half: '2027-H1' } : i)) }));
    expect(out.flags).toContainEqual(expect.objectContaining({ kind: 'wrong_half', page_id: 'h1' }));
  });

  it('puts overdue docs in the markdown', () => {
    expect(planDocCheck(fixture()).markdown).toContain('🔴 [IDEA-1] X — Brief/PRD (due 2026-10-01)');
  });
});
```

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Implement `shared/doc-check-run.ts`**

```ts
// The doc check's pure core: Confluence tree + TaskManager health + roadmap → what to write.
// Spec §5; plan D3–D5. No I/O here; the CLI (backend/src/scripts/doc-check.ts) does that.

import type { DocEvidence, DocKey } from './doc-matrix';
import type { DocHealthProject } from './types';
import type { AdfNode } from './confluence-adf';
import type { GeneratedSection } from './confluence-adf';
import { classifyTitle } from './doc-evidence';
import { checklistContent, defaultSettings, itemDocRows, statusContent, STATUS_LABEL, type HubItem, type HubSettings } from './confluence-hub';
import { rollupContent, settingsContent, type RollupRow } from './confluence-rollup';
import { confluencePageId, NEVER_LINK } from './confluence-migration';
import { halfTitle } from './confluence-tree';
import { addDays } from './doc-matrix';

export interface TreePage { id: string; title: string; parentId: string | null; status: 'current' | 'draft' }

export interface DocCheckProject extends DocHealthProject { settings: HubSettings }

export interface DocCheckInput {
  today: string;
  /** URL prefix for page links, e.g. https://minted.atlassian.net/wiki/spaces/PM/pages/ */
  base: string;
  /** Descendants of the Roadmap Projects root, plus the root itself. */
  tree: TreePage[];
  /** Manifest node key → page id (root, year:*, half:*, team_half:*, hub:*, proposals*, not_pursued*, unscheduled*). */
  manifest: Record<string, string>;
  projects: DocCheckProject[];
  items: (HubItem & { dev_start_half: string | null })[];
  /** Page id → where it is already recorded as evidence. */
  recordedPageIds: Record<string, { project_id: string; key: DocKey }>;
  /** Page ids Brice marked "not a doc". */
  ignored: string[];
}

export interface Proposal { project_id: string; project: string; page_id: string; title: string; key: DocKey }
export type Flag =
  | { kind: 'no_hub'; project_id: string; project: string }
  | { kind: 'wrong_half'; page_id: string; title: string; expected: string }
  | { kind: 'unclassified'; page_id: string; title: string; hub: string }
  | { kind: 'mismatch'; project: string; doc: string };
export interface SectionWrite { page_id: string; section: GeneratedSection; content: AdfNode[] }

export interface DocCheckOutput {
  /** project_id → evidence to send to POST /api/docs/apply (only keys that changed). */
  evidence: Record<string, Partial<Record<DocKey, DocEvidence>>>;
  proposals: Proposal[];
  flags: Flag[];
  writes: SectionWrite[];
  markdown: string;
}

const ROLLUP_KEY = /^(root|year:|half:|team_half:|proposals|team_proposals|not_pursued|team_not_pursued|unscheduled|team_unscheduled)/;

export function planDocCheck(inp: DocCheckInput): DocCheckOutput {
  const byId = new Map(inp.tree.map((t) => [t.id, t]));
  const children = (id: string) => inp.tree.filter((t) => t.parentId === id);
  const ancestors = (id: string): TreePage[] => {
    const out: TreePage[] = [];
    for (let cur = byId.get(id)?.parentId; cur && byId.has(cur); cur = byId.get(cur)!.parentId) out.push(byId.get(cur)!);
    return out;
  };
  const hubIds = new Set(Object.entries(inp.manifest).filter(([k]) => k.startsWith('hub:')).map(([, v]) => v));
  for (const p of inp.projects) { const id = confluencePageId(p.hub_url); if (id) hubIds.add(id); }

  const projectForHub = (hubId: string) =>
    inp.projects.find((p) => confluencePageId(p.hub_url) === hubId)
    ?? inp.projects.find((p) => p.roadmap_item_id && inp.manifest[`hub:${p.roadmap_item_id}`] === hubId);
  const itemForHub = (hubId: string) => {
    const key = Object.entries(inp.manifest).find(([k, v]) => k.startsWith('hub:') && v === hubId)?.[0];
    const itemId = key?.slice('hub:'.length) ?? projectForHub(hubId)?.roadmap_item_id ?? null;
    return inp.items.find((i) => i.id === itemId);
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

    // Evidence and proposals from the hub's children.
    for (const c of children(hubId)) {
      if (inp.recordedPageIds[c.id] || inp.ignored.includes(c.id)) continue;
      const cls = classifyTitle(c.title);
      if (!cls) { flags.push({ kind: 'unclassified', page_id: c.id, title: c.title, hub: hub.title }); continue; }
      if (!project) continue;
      if (NEVER_LINK.some((n) => n.pageId === c.id && n.notTeam === project.team)) continue;
      if (cls.confidence === 'exact') {
        (evidence[project.project_id] ??= {})[cls.key] = { page_url: `${inp.base}${c.id}`, published: c.status === 'current' };
      } else {
        proposals.push({ project_id: project.project_id, project: project.name, page_id: c.id, title: c.title, key: cls.key });
      }
    }

    // Sections.
    if (item) writes.push({ page_id: hubId, section: 'status', content: statusContent(item, inp.today) });
    const rows = project?.rows ?? (item ? itemDocRows(item, inp.today) : []);
    writes.push({ page_id: hubId, section: 'checklist', content: checklistContent(rows) });
    writes.push({ page_id: hubId, section: 'settings', content: settingsContent(project?.settings ?? defaultSettings(item ?? { stage: 'roadmap' })) });

    // Wrong half.
    const half = item?.dev_start_half;
    if (half) {
      const expected = halfTitle(half);
      const filedUnder = ancestors(hubId).find((a) => /^H[12]'\d\d$/.test(a.title));
      if (filedUnder && filedUnder.title !== expected) flags.push({ kind: 'wrong_half', page_id: hubId, title: hub.title, expected });
    }
  }

  for (const p of inp.projects) {
    if (p.docs_stage === 'roadmap' && !confluencePageId(p.hub_url)) flags.push({ kind: 'no_hub', project_id: p.project_id, project: p.name });
    for (const r of p.rows) if (r.mismatch) flags.push({ kind: 'mismatch', project: p.name, doc: r.label });
  }

  // Roll-ups: every manifest roll-up page lists the hubs beneath it.
  const rollupRow = (hubId: string): RollupRow => {
    const project = projectForHub(hubId);
    const item = itemForHub(hubId);
    const rows = project?.rows ?? (item ? itemDocRows(item, inp.today) : []);
    return {
      name: byId.get(hubId)!.title.replace(/ — Hub$/, ''),
      hubUrl: `${inp.base}${hubId}`,
      stage: item?.stage ?? project?.roadmap_stage ?? null,
      cells: Object.fromEntries(rows.map((r) => [r.key, r.status])),
      overdue: rows.filter((r) => r.status === 'overdue').length,
    };
  };
  for (const [key, pageId] of Object.entries(inp.manifest)) {
    if (!ROLLUP_KEY.test(key) || !byId.has(pageId)) continue;
    const under = [...hubIds].filter((h) => byId.has(h) && ancestors(h).some((a) => a.id === pageId));
    writes.push({ page_id: pageId, section: 'rollup', content: rollupContent(under.map(rollupRow)) });
  }

  return { evidence, proposals, flags, writes, markdown: renderMarkdown(inp, proposals, flags) };
}

function renderMarkdown(inp: DocCheckInput, proposals: Proposal[], flags: Flag[]): string {
  const soon = addDays(inp.today, 7);
  const lines: string[] = ['## 📚 Docs'];
  const overdue: string[] = [];
  const dueSoon: string[] = [];
  for (const p of inp.projects) for (const r of p.rows) {
    if (r.status === 'overdue') overdue.push(`- 🔴 ${p.name} — ${r.label} (due ${r.due})`);
    else if (r.status === 'due_soon' && r.due && r.due <= soon) dueSoon.push(`- ⏳ ${p.name} — ${r.label} (due ${r.due})`);
  }
  lines.push(overdue.length ? `**Overdue (${overdue.length})**\n${overdue.join('\n')}` : '**Overdue:** none');
  if (dueSoon.length) lines.push(`**Due this week**\n${dueSoon.join('\n')}`);
  if (proposals.length) {
    lines.push('**Looks like a doc — confirm?**');
    for (const pr of proposals) lines.push(`- ${pr.project}: "${pr.title}" → ${pr.key} (\`accept ${pr.project_id} ${pr.key} ${pr.page_id}\`)`);
  }
  const label: Record<Flag['kind'], (f: any) => string> = {
    no_hub: (f) => `${f.project} has no hub`,
    wrong_half: (f) => `${f.title} should move to ${f.expected}`,
    unclassified: (f) => `"${f.title}" under ${f.hub} isn't a recognised doc (\`ignore ${f.page_id}\` to hide)`,
    mismatch: (f) => `${f.project}: ${f.doc} link differs between roadmap and Confluence`,
  };
  if (flags.length) lines.push(`**Flags**\n${flags.map((f) => `- ${label[f.kind](f)}`).join('\n')}`);
  void STATUS_LABEL;
  return lines.join('\n\n');
}
```

`NEVER_LINK` (in `shared/confluence-migration.ts`) is a list of `{ pageId, notTeam, reason }`. A barred page is never evidence or a proposal for a project on `notTeam`. Add a test for it: a child with id `4286087221` under a WW project's hub produces neither. Remove the `void STATUS_LABEL;` line and its import if tsc or lint flags them as unused.

An exact `Experiment Brief` title matches `experiment_brief.plan` first, because `DOC_MATRIX` lists plan before results and both share the page title. The results half is recorded from the same page by the CLI (Task 6), never by the classifier.

- [ ] **Step 4: Run all tests and tsc.** Both clean.
- [ ] **Step 5: Commit**

```bash
git add shared/doc-check-run.ts backend/src/test/doc-check-run.test.ts
git commit -m "feat(doc-check): pure core turning a snapshot into writes, proposals and the briefing section"
```

---

### Task 5: Confluence REST client

**Goal:** A small client that runs requests strictly one at a time, reads the token from the Keychain and covers the four calls the check needs.

**Files:**
- Create: `backend/src/lib/confluence-rest.ts`
- Test: `backend/src/test/confluence-rest.test.ts`

**Acceptance Criteria:**
- [ ] `descendants(rootId)` follows `_links.next` until done and returns `{id,title,parentId,status}` for every page, including drafts.
- [ ] `getAdf(id)` returns `{ version, title, status, body }` with `body` parsed from `atlas_doc_format`.
- [ ] `putAdf(id, {version, title, status, body})` sends `version.number = version + 1`. A 409 throws a `ConflictError`, which the CLI reports and skips.
- [ ] Two calls started together never overlap. The test asserts this with a fake `fetch` that records how many requests are in flight at once.
- [ ] The token is read with `security find-generic-password -s taskmanager-confluence -a <email> -w` and never logged.

**Verify:** `cd backend && npx vitest run src/test/confluence-rest.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Write the tests** with `vi.stubGlobal('fetch', fake)` and an injected token getter (`new ConfluenceRest({ base, email, token: () => 't' })`):

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ConfluenceRest, ConflictError } from '../lib/confluence-rest';

afterEach(() => vi.unstubAllGlobals());

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });

describe('ConfluenceRest', () => {
  it('never overlaps requests', async () => {
    let inFlight = 0, max = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      inFlight++; max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return json({ id: '1', title: 't', status: 'current', version: { number: 3 }, body: { atlas_doc_format: { value: '{"type":"doc","version":1,"content":[]}' } } });
    }));
    const c = new ConfluenceRest({ base: 'https://x', email: 'e', token: () => 't' });
    await Promise.all([c.getAdf('1'), c.getAdf('2'), c.getAdf('3')]);
    expect(max).toBe(1);
  });

  it('pages through descendants', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ results: [{ id: 'a', title: 'A', parentId: 'r', status: 'current' }], _links: { next: '/wiki/api/v2/pages/r/descendants?cursor=2' } }))
      .mockResolvedValueOnce(json({ results: [{ id: 'b', title: 'B', parentId: 'a', status: 'draft' }], _links: {} })));
    const c = new ConfluenceRest({ base: 'https://x', email: 'e', token: () => 't' });
    expect((await c.descendants('r')).map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('bumps the version and maps 409 to ConflictError', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({}, 409));
    vi.stubGlobal('fetch', fetchMock);
    const c = new ConfluenceRest({ base: 'https://x', email: 'e', token: () => 't' });
    await expect(c.putAdf('1', { version: 3, title: 'T', status: 'current', body: { type: 'doc', version: 1, content: [] } })).rejects.toBeInstanceOf(ConflictError);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).version.number).toBe(4);
  });
});
```

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Implement `backend/src/lib/confluence-rest.ts`**

```ts
// Minimal Confluence Cloud REST v2 client for the doc check. Requests run one at a time:
// the Atlassian MCP has a concurrency bug, and there's no reason to risk it here either.

import { execFileSync } from 'child_process';
import type { AdfDoc } from '../../../shared/confluence-adf';

export class ConflictError extends Error {}

export interface RestPage { id: string; title: string; parentId: string | null; status: 'current' | 'draft' }
export interface AdfPage { version: number; title: string; status: 'current' | 'draft'; body: AdfDoc }

export function keychainToken(email: string): string {
  return execFileSync('security', ['find-generic-password', '-s', 'taskmanager-confluence', '-a', email, '-w'], { encoding: 'utf8' }).trim();
}

export class ConfluenceRest {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private opts: { base: string; email: string; token: () => string }) {}

  private request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const run = async () => {
      const auth = Buffer.from(`${this.opts.email}:${this.opts.token()}`).toString('base64');
      const res = await fetch(`${this.opts.base}${path}`, {
        ...init,
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      });
      if (res.status === 409) throw new ConflictError(`409 on ${path}`);
      if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}`);
      return (await res.json()) as T;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async descendants(rootId: string): Promise<RestPage[]> {
    const out: RestPage[] = [];
    let path: string | undefined = `/wiki/api/v2/pages/${rootId}/descendants?limit=250&depth=10`;
    while (path) {
      const r: { results: RestPage[]; _links?: { next?: string } } = await this.request(path);
      out.push(...r.results.map(({ id, title, parentId, status }) => ({ id, title, parentId, status })));
      path = r._links?.next;
    }
    return out;
  }

  async getAdf(id: string): Promise<AdfPage> {
    const r: { title: string; status: 'current' | 'draft'; version: { number: number }; body: { atlas_doc_format: { value: string } } } =
      await this.request(`/wiki/api/v2/pages/${id}?body-format=atlas_doc_format`);
    return { version: r.version.number, title: r.title, status: r.status, body: JSON.parse(r.body.atlas_doc_format.value) };
  }

  async putAdf(id: string, page: AdfPage): Promise<void> {
    await this.request(`/wiki/api/v2/pages/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        id, status: page.status, title: page.title,
        body: { representation: 'atlas_doc_format', value: JSON.stringify(page.body) },
        version: { number: page.version + 1, message: 'Doc check' },
      }),
    });
  }
}
```

- [ ] **Step 4: Run all tests and tsc.** Both clean.
- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/confluence-rest.ts backend/src/test/confluence-rest.test.ts
git commit -m "feat(doc-check): sequential Confluence REST client with Keychain token"
```

---

### Task 6: The CLI and the one-time settings migration

**Goal:** `npm run doc-check -- run|accept|ignore|migrate-settings` works end to end against a local TaskManager and Confluence.

**Files:**
- Create: `backend/src/scripts/doc-check.ts`
- Create: `docs/confluence/doc-check-ignore.json` (`[]`)
- Modify: `backend/package.json` (script `"doc-check": "ts-node --transpile-only src/scripts/doc-check.ts"`)
- Modify: `.gitignore` (`docs/confluence/state/`)

**Acceptance Criteria:**
- [ ] `run` (dry run) prints the Markdown and a summary line: `N evidence updates, N proposals, N sections to write (N unchanged, N skipped)`. It makes no PUT and no POST to `/api/docs/apply`.
- [ ] `run --write`:
  - POSTs `/api/docs/apply` once per project that has new evidence;
  - re-reads `/api/docs/health`, so the checklists show the new statuses;
  - for each write, GETs the page, skips it if `sectionContent()` is null (reported as skipped), skips it if the normalised content is equal (unchanged), else PUTs it via `replaceGenerated()`;
  - on `ConflictError`, skips the page (reported, retried tomorrow);
  - saves a run log to `docs/confluence/state/YYYY-MM-DD.json`.
- [ ] For a project with experiment-brief evidence, the results row gets evidence for the same page, with `results_filled` from `resultsFilled()` (D6). The page is fetched once per run, only while the results row isn't done, waived or inactive.
- [ ] `accept <projectId> <docKey> <pageId>` POSTs that one evidence item, with `published` from the page's status.
- [ ] `ignore <pageId>` appends the id to `doc-check-ignore.json`.
- [ ] `migrate-settings [--write]` adds a `doc-check-settings` marker to every hub that lacks one. It finds the top-level "Settings" heading and replaces the paragraph and table after it with `generated('settings', settingsContent(...))`. Without `--write` it lists what it would change.
- [ ] Exit code is non-zero only if TaskManager or Confluence is unreachable. Individual page failures are reported, not fatal.

**Verify:** `cd backend && npx tsc --noEmit -p . && npm run doc-check -- run | tail -3` → the Markdown ends with the summary line (needs the backend running and the token from Task 0)

**Steps:**

- [ ] **Step 1: Implement `backend/src/scripts/doc-check.ts`**

```ts
// Usage (from backend/):
//   npm run doc-check -- run [--write]
//   npm run doc-check -- accept <projectId> <docKey> <pageId>
//   npm run doc-check -- ignore <pageId>
//   npm run doc-check -- migrate-settings [--write]
// Reads TaskManager at TASKMANAGER_API_URL (default http://localhost:3001/api) and Confluence
// with the Keychain token (docs/confluence/README.md). Dry run unless --write.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { ConfluenceRest, ConflictError, keychainToken } from '../lib/confluence-rest';
import { planDocCheck, type DocCheckProject } from '../../../shared/doc-check-run';
import { generated, normalizeForCompare, replaceGenerated, sectionContent, findGenerated, adfText, type AdfDoc } from '../../../shared/confluence-adf';
import { settingsContent } from '../../../shared/confluence-rollup';
import { resultsFilled } from '../../../shared/doc-evidence';
import { confluencePageId } from '../../../shared/confluence-migration';
import { defaultSettings, type HubItem } from '../../../shared/confluence-hub';
import type { DocKey } from '../../../shared/doc-matrix';
import type { DocHealthResponse } from '../../../shared/types';
import { todayIso } from '../lib/doc-check';

const API = process.env.TASKMANAGER_API_URL || 'http://localhost:3001/api';
const EMAIL = process.env.CONFLUENCE_EMAIL || 'brice.fenger@minted.com';
const BASE = process.env.CONFLUENCE_BASE || 'https://minted.atlassian.net';
const DIR = resolve(__dirname, '../../../docs/confluence');
const MANIFEST = join(DIR, 'manifest.json');
const IGNORE = join(DIR, 'doc-check-ignore.json');
const STATE = join(DIR, 'state');

const readJson = <T>(p: string, fallback?: T): T => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : (fallback as T));
const conf = new ConfluenceRest({ base: BASE, email: EMAIL, token: () => keychainToken(EMAIL) });

async function tm<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Actor': 'doc-check' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

function manifestIds(): { root: string; ids: Record<string, string> } {
  const m = readJson<{ nodes: Record<string, { pageId: string | null }> }>(MANIFEST);
  const ids = Object.fromEntries(Object.entries(m.nodes).filter(([, v]) => v.pageId).map(([k, v]) => [k, v.pageId as string]));
  return { root: ids.root, ids };
}

async function snapshot() {
  const { root, ids } = manifestIds();
  const [health, projectsRaw, items, tree] = await Promise.all([
    tm<DocHealthResponse>('/docs/health'),
    tm<{ id: string; doc_mode: 'full' | 'one_pager_only'; customer_facing: boolean; waivers: Record<string, string> }[]>('/projects'),
    tm<(HubItem & { dev_start_half: string | null })[]>('/roadmap'),
    conf.descendants(root),
  ]);
  const settings = new Map(projectsRaw.map((p) => [p.id, { doc_mode: p.doc_mode ?? 'full', customer_facing: Boolean(p.customer_facing), waivers: p.waivers ?? {} }]));
  const projects: DocCheckProject[] = health.projects.map((p) => ({ ...p, settings: settings.get(p.project_id) ?? defaultSettings({ stage: p.roadmap_stage ?? 'roadmap' }) }));
  const recordedPageIds: Record<string, { project_id: string; key: DocKey }> = {};
  for (const p of health.projects) for (const r of p.rows) {
    const id = confluencePageId(r.link);
    if (id && r.key !== 'hub') recordedPageIds[id] = { project_id: p.project_id, key: r.key };
  }
  return {
    today: todayIso(), base: `${BASE}/wiki/spaces/PM/pages/`,
    tree: [{ id: root, title: 'Roadmap Projects', parentId: null, status: 'current' as const }, ...tree],
    manifest: ids, projects, items, recordedPageIds, ignored: readJson<string[]>(IGNORE, []),
  };
}

/** The results half of an experiment brief lives on the plan's page (spec §1); D6 decides "filled". */
async function addResultsEvidence(inp: Awaited<ReturnType<typeof snapshot>>, out: ReturnType<typeof planDocCheck>) {
  for (const p of inp.projects) {
    const plan = p.rows.find((r) => r.key === 'experiment_brief.plan');
    const results = p.rows.find((r) => r.key === 'experiment_brief.results');
    const id = confluencePageId(plan?.link ?? out.evidence[p.project_id]?.['experiment_brief.plan']?.page_url);
    if (!id || !results || results.status === 'waived' || results.status === 'inactive') continue;
    const page = await conf.getAdf(id);
    const filled = resultsFilled(page.body);
    if (results.link && confluencePageId(results.link) === id && results.status === 'done') continue;
    (out.evidence[p.project_id] ??= {})['experiment_brief.results'] =
      { page_url: `${BASE}/wiki/spaces/PM/pages/${id}`, published: page.status === 'current', results_filled: filled };
  }
}

async function run(write: boolean) {
  let inp = await snapshot();
  let out = planDocCheck(inp);
  await addResultsEvidence(inp, out);
  const evidenceUpdates = Object.keys(out.evidence).length;
  if (write && evidenceUpdates) {
    for (const [project_id, evidence] of Object.entries(out.evidence)) await tm('/docs/apply', { project_id, evidence });
    inp = await snapshot();
    out = planDocCheck(inp);
  }
  let written = 0, unchanged = 0;
  const skipped: string[] = [];
  for (const w of out.writes) {
    try {
      const page = await conf.getAdf(w.page_id);
      const current = sectionContent(page.body, w.section);
      if (current === null) { skipped.push(`${w.page_id} ${w.section}: marker missing or duplicated`); continue; }
      if (JSON.stringify(normalizeForCompare(current)) === JSON.stringify(normalizeForCompare(w.content))) { unchanged++; continue; }
      if (!write) { written++; continue; }
      const r = replaceGenerated(page.body, w.section, w.content);
      if (!r.replaced) { skipped.push(`${w.page_id} ${w.section}: ${r.reason}`); continue; }
      await conf.putAdf(w.page_id, { ...page, body: r.doc });
      written++;
    } catch (e) {
      skipped.push(`${w.page_id} ${w.section}: ${e instanceof ConflictError ? 'edited by someone else, retry tomorrow' : (e as Error).message}`);
    }
  }
  const verb = write ? 'written' : 'to write';
  console.log(out.markdown);
  console.log(`\n_${evidenceUpdates} evidence updates, ${out.proposals.length} proposals, ${written} sections ${verb} (${unchanged} unchanged, ${skipped.length} skipped)._`);
  for (const s of skipped) console.log(`- skipped ${s}`);
  if (write) {
    mkdirSync(STATE, { recursive: true });
    writeFileSync(join(STATE, `${inp.today}.json`), JSON.stringify({ evidence: out.evidence, proposals: out.proposals, flags: out.flags, written, unchanged, skipped }, null, 2) + '\n');
  }
}

async function accept(projectId: string, key: string, pageId: string) {
  const page = await conf.getAdf(pageId);
  await tm('/docs/apply', { project_id: projectId, evidence: { [key]: { page_url: `${BASE}/wiki/spaces/PM/pages/${pageId}`, published: page.status === 'current' } } });
  console.log(`recorded ${pageId} as ${key} on ${projectId}`);
}

function ignore(pageId: string) {
  const list = readJson<string[]>(IGNORE, []);
  if (!list.includes(pageId)) writeFileSync(IGNORE, JSON.stringify([...list, pageId], null, 2) + '\n');
  console.log(`ignoring ${pageId}`);
}

async function migrateSettings(write: boolean) {
  const inp = await snapshot();
  const hubs = Object.entries(inp.manifest).filter(([k]) => k.startsWith('hub:')).map(([, v]) => v);
  for (const id of hubs) {
    const page = await conf.getAdf(id);
    if (findGenerated(page.body, 'settings').length) { console.log(`${id}: already migrated`); continue; }
    const at = page.body.content.findIndex((n) => n.type === 'heading' && adfText(n).trim() === 'Settings');
    if (at < 0) { console.log(`${id}: no Settings heading, skipped`); continue; }
    let end = at + 1;
    while (end < page.body.content.length && page.body.content[end].type !== 'heading' && end <= at + 2) end++;
    const project = inp.projects.find((p) => confluencePageId(p.hub_url) === id);
    const block = generated('settings', settingsContent(project?.settings ?? defaultSettings({ stage: 'roadmap' })));
    const body: AdfDoc = { ...page.body, content: [...page.body.content.slice(0, at + 1), block, ...page.body.content.slice(end)] };
    console.log(`${id}: ${write ? 'migrating' : 'would migrate'} (${end - at - 1} nodes replaced)`);
    if (write) await conf.putAdf(id, { ...page, body });
  }
}

const [cmd, ...args] = process.argv.slice(2);
const write = args.includes('--write');
(async () => {
  if (cmd === 'run') await run(write);
  else if (cmd === 'accept') await accept(args[0], args[1], args[2]);
  else if (cmd === 'ignore') ignore(args[0]);
  else if (cmd === 'migrate-settings') await migrateSettings(write);
  else throw new Error('usage: run [--write] | accept <projectId> <docKey> <pageId> | ignore <pageId> | migrate-settings [--write]');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
```

`/api/projects` returns `id`, while health rows use `project_id`. The code above maps by `project_id`, so check the field names with one `curl` before relying on them.

- [ ] **Step 2: Add the npm script, the ignore file and the gitignore line.**

```bash
cd backend && npm pkg set scripts.doc-check="ts-node --transpile-only src/scripts/doc-check.ts" && cd ..
echo '[]' > docs/confluence/doc-check-ignore.json
printf 'docs/confluence/state/\n' >> .gitignore
```

- [ ] **Step 3: Smoke-test the dry run** (backend running, token from Task 0): `cd backend && npm run doc-check -- run`. Expect the Docs Markdown and a summary line. No page versions change: check one hub's version before and after with `getConfluencePage` (one MCP call each, one at a time).
- [ ] **Step 4: Dry-run the migration:** `npm run doc-check -- migrate-settings`. Expect "would migrate" for every published hub, and nothing for drafts that have no Settings heading.
- [ ] **Step 5: Run all tests and tsc.** Both clean.
- [ ] **Step 6: Commit**

```bash
git add backend/src/scripts/doc-check.ts backend/package.json docs/confluence/doc-check-ignore.json .gitignore
git commit -m "feat(doc-check): CLI for run, accept, ignore and the settings migration"
```

---

### Task 7: Backfill evidence for the pages Brice already moved

**Goal:** The pages Brice moved under hubs on 2026-10-28 are recorded, or deliberately ignored, before the daily run starts, so the first briefing isn't a wall of "confirm?" lines.

**Files:**
- Modify: `docs/confluence/doc-check-ignore.json`

**Acceptance Criteria:**
- [ ] Brice has seen the proposal list from a dry run and said, for each one, accept, ignore or skip.
- [ ] Accepted ones are recorded via `accept`. A second dry run shows no proposals except the ones he chose to skip.

**Verify:** `cd backend && npm run doc-check -- run | grep -c "accept "` → the number of proposals Brice chose to leave open (expected 0)

**Steps:**

- [ ] **Step 1: Dry run** and copy the "Looks like a doc — confirm?" and "isn't a recognised doc" lines into chat for Brice. Expected candidates include:
  - Upload Your Own Design brief;
  - Adult/Child brief and its experimentation doc;
  - Print Upsell brief and its experimentation doc;
  - Messaging Center brief and its experiment brief (under Message Send Iteration);
  - RSVP brief;
  - Modular Home Page PRD;
  - Cash Registry Transition (under Registry Phase 2);
  - the new Photo/Video PRD.
  Several of these sit under hubs whose items have no TaskManager project (H1'26 items). Those produce no proposals, only "unclassified" if they match nothing, since evidence needs a project. The briefing shouldn't nag about them: offer to `ignore` them.
- [ ] **Step 2: Apply Brice's answers,** one command each: `accept …` or `ignore …`.
- [ ] **Step 3: Commit the ignore list**

```bash
git add docs/confluence/doc-check-ignore.json
git commit -m "chore(doc-check): pages Brice marked as not docs"
```

---

### Task 8: First write on live data

**Goal:** The settings migration and one full `run --write` have been done with Brice's go, and the hubs look right.

**Files:** none (Confluence and TaskManager data only)

**Acceptance Criteria:**
- [ ] Brice approved, in chat, `migrate-settings --write` after seeing the dry-run list.
- [ ] Brice approved `run --write` after seeing the dry run's summary line and the list of pages it would write.
- [ ] After the write, a second `run` (dry) reports `0 sections to write` and every page as unchanged. This proves the compare-and-skip works.
- [ ] Two hubs and one roll-up are opened in the browser and look right: the status, checklist and settings tables are filled, and the hand-written sections are untouched.

**Verify:** `cd backend && npm run doc-check -- run | tail -2` → `… 0 sections to write (N unchanged, 0 skipped)`

**Steps:**

- [ ] **Step 1:** Show Brice the `migrate-settings` dry-run output. On his yes: `npm run doc-check -- migrate-settings --write`.
- [ ] **Step 2:** `npm run doc-check -- run` (dry). Show him the summary and the skipped list. On his yes: `npm run doc-check -- run --write`.
- [ ] **Step 3:** Run the dry run again and confirm `0 sections to write`. If anything still shows as changing, `normalizeForCompare` is missing a volatile attribute. Find it by diffing the two JSONs for that page, add it to `VOLATILE` with a test (Task 1's test file), and repeat.
- [ ] **Step 4:** Check the hubs, then update the shared notes file `step3-confluence-plan.md` (or a new `step4-doc-check.md`) in the side-session notes folder with the status.

---

### Task 9: Rework the morning briefing

**Goal:** `daily-morning-briefing` runs the doc check, shows the Docs section, and stops doing what the doc system owns.

**Files:**
- Modify (outside repo): `~/.claude/scheduled-tasks/daily-morning-briefing/SKILL.md`
- Backup: `~/.claude/scheduled-tasks/daily-morning-briefing/SKILL.2026-10-28.bak.md`

**Acceptance Criteria:**
- [ ] **Step 0 preflight:** restarts the backend with `launchctl kickstart -k gui/$(id -u)/com.brice.taskmanager-backend` instead of `npm run dev`. The backend is a LaunchAgent with `KeepAlive`, so `npm run dev` would fight it for port 3001.
- [ ] **New "Doc check" step,** after Agent A returns and before Step 3. It runs:
  1. `list_roadmap_items(team="Digital Products", includeSubteams=true, stage="roadmap,build,measure,on-hold,wont-do")`, then `sync_roadmap` with the items. If the roadmap MCP fails, the step says "Roadmap not synced since <date>" and continues.
  2. One Bash call: `npm --prefix /Users/brice.fenger/TaskManager/backend run doc-check -- run --write`.
  3. Its stdout goes into the briefing as the **📚 Docs** section, right after "Must do today". A non-zero exit becomes a "⚠️ Doc check failed: <stderr first line>" line under Data gaps.
- [ ] **Agent A, item 5 (canonical page health, Mondays):** removed. It is replaced by the doc check's hub status.
- [ ] **Agent A, item 4 (timeline sync):** reads the IDEA keys from TaskManager projects (`jira_key` via `GET /api/roadmap` joined to linked projects) instead of `state/project-timelines.md`.
  - Under D2 = roadmap tool, it reports `KEY | jira_build_start | jira_release | roadmap_build_start | roadmap_build_end | MATCH or DRIFT`.
  - Under D2 = Jira, it keeps today's comparison.
- [ ] **Step 3 timeline sync (writes):**
  - It never touches a task with a `doc_key` (those belong to the doc check) or a task with a pinned due date.
  - Under D2 = roadmap tool, it re-dates only non-doc lifecycle tasks, from roadmap phase dates (Build start, Build end as the release, Measure end), with the same rules table minus the release-notes, metrics and readout rows, which are now doc tasks.
  - DRIFT rows are reported in the briefing, not written.
- [ ] **Step 4 (draft-deliverables)** is passed each project's `hub_url`, not a canonical page ID.
- [ ] Brice has seen the full diff (old vs new SKILL.md) and approved it before it is saved.

**Verify:** `diff ~/.claude/scheduled-tasks/daily-morning-briefing/SKILL.2026-10-28.bak.md ~/.claude/scheduled-tasks/daily-morning-briefing/SKILL.md | head -80` → shows exactly the changes above; then a manual "Run now" (`run_scheduled_task`) produces a briefing with a 📚 Docs section

**Steps:**

- [ ] **Step 1: Back up the current file**

```bash
cp ~/.claude/scheduled-tasks/daily-morning-briefing/SKILL.md ~/.claude/scheduled-tasks/daily-morning-briefing/SKILL.2026-10-28.bak.md
```

- [ ] **Step 2: Write the new Doc check step** (insert after Step 2, renumbering later steps):

```markdown
## Step 2b: Doc check (after Agent A has returned — never while it runs)
1. Roadmap: load `mcp__roadmap__list_roadmap_items` and `mcp__taskmanager__sync_roadmap` via ToolSearch.
   Call `list_roadmap_items(team="Digital Products", includeSubteams=true, stage="roadmap,build,measure,on-hold,wont-do")`,
   then `sync_roadmap` with the returned items. If either fails, note "Roadmap not synced since
   <last synced_at>" under Data gaps and continue (the check uses the last snapshot).
2. Run the check in ONE Bash call:
   `npm --prefix /Users/brice.fenger/TaskManager/backend run doc-check -- run --write`
   It reads Confluence with its own token (not the Atlassian MCP), applies evidence to
   TaskManager, rewrites only the generated sections that changed, and prints Markdown.
3. Put its stdout in the briefing as the "📚 Docs" section, right after "Must do today".
   Do not re-run it, re-format it, or act on its "confirm?" lines; those are for Brice.
   If it exits non-zero, add "⚠️ Doc check failed: <first line of stderr>" under Data gaps.
```

- [ ] **Step 3: Edit Step 0** (the restart command), **Agent A items 4–5**, **Step 3 timeline sync** and **Step 4** as described in the acceptance criteria. Keep every other section byte-for-byte.
- [ ] **Step 4: Show Brice the diff** (`diff -u` of backup vs new) in chat and wait for his yes before saving. If he wants changes, make them and show the diff again.
- [ ] **Step 5: Test run:** `run_scheduled_task` for `daily-morning-briefing` (with Brice's go, since it creates TaskManager tasks from meeting notes). Read the resulting `artifacts/daily/YYYY-MM-DD-start.md` and confirm the 📚 Docs section is there.

---

### Task 10: Point the helpers at hubs and retire the mapping file

**Goal:** Nothing in the assistant's files still depends on `project-timelines.md` canonical page IDs, and the lifecycle template stops duplicating doc tasks.

**Files (all outside repo, under `/Users/brice.fenger/Claude Assistant/`):**
- Modify: `.claude/skills/draft-deliverables/SKILL.md`
- Modify: `knowledge/project-lifecycle-template.md`
- Modify: `state/project-timelines.md` (header only)
- Check: `~/.claude/scheduled-tasks/friday-weekly-review-prep/SKILL.md`, `~/.claude/scheduled-tasks/monday-weekly-planning/SKILL.md`, `.claude/skills/scaffold-project/SKILL.md`

**Acceptance Criteria:**
- [ ] draft-deliverables:
  - files new drafts as children of the project's hub (`hub_url` from TaskManager), titled with `docPageTitle` (`[XX] <name> — <Doc label>`), so the doc check records them automatically;
  - no longer edits a canonical page's Key Links table.
- [ ] The lifecycle template drops the rows the matrix covers: experimentation doc, release notes, 2-week metrics check, final results readout. It keeps kickoff, mid-build check-in, QA, the CS/Marketing share and the retro, as spec §2 says.
- [ ] `project-timelines.md` starts with a banner: "Retired 2026-<date>: mapping lives in TaskManager (project ↔ roadmap item, hub_url). Kept for history; no step reads it." Its history stays.
- [ ] `grep -l "project-timelines\|Canonical Page ID" ` across the three other skills lists nothing, or each remaining hit is updated with Brice's OK.
- [ ] Brice has seen each diff before it is saved.

**Verify:** `grep -rln "Canonical Page ID" ~/.claude/scheduled-tasks "/Users/brice.fenger/Claude Assistant/.claude/skills"` → no output

**Steps:**

- [ ] **Step 1:** Back up each file (`cp f f.2026-10-28.bak`). Then make the edits above, show Brice each diff, and save on his yes.
- [ ] **Step 2:** Run the grep from Verify. Fix the remaining hits the same way.
- [ ] **Step 3:** Add a line to `docs/confluence/README.md` listing the outside-repo files this plan changed and their backups, then commit:

```bash
git add docs/confluence/README.md
git commit -m "docs(doc-check): record briefing and helper changes outside the repo"
```

---

## Self-review notes

- **Spec §5 coverage:**
  - Read roadmap: Task 9 step 2b.1. Read Confluence and TaskManager: Task 6 `snapshot()`.
  - Compute statuses: existing `/docs/health`. Compute flags: Task 4, covering no hub, wrong half, mismatch and unclassified.
  - Write: TaskManager via `apply` (Task 6), hubs and roll-ups (Tasks 4 and 6), the briefing section (Task 9).
  - **Not covered, by design:** "Go but not on the roadmap" and "awaiting decision" belong to the proposals flow (step 5). Write-back is step 6.
- **Failure handling:**
  - Roadmap MCP down → noted, last snapshot used (Task 9).
  - Confluence failures → per-page skip and retry tomorrow (Task 6).
  - Idempotent → upserts plus compare-and-skip (Tasks 6 and 8).
- **Titles checked against `DOC_MATRIX`** (2026-10-28):
  - Every `pageTitle` (`One-Pager`, `Research Synthesis`, `Brief/PRD`, `Experiment Brief`, `CS/Marketing Brief`, `Release Notes`, `Metrics Snapshot`) is the suffix `classifyTitle` looks for.
  - `NEVER_LINK` is `{ pageId, notTeam, reason }[]`, as used in Task 4.
  - `halfTitle('2026-H2')` returns `H2'26`, as the wrong-half check assumes.

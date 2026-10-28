// Usage (from backend/):
//   npm run doc-check -- run [--write] [--diff]
//   npm run doc-check -- accept <projectId> <docKey> <pageId>
//   npm run doc-check -- ignore <pageId>
//   npm run doc-check -- migrate-settings [--write]
// Reads TaskManager at TASKMANAGER_API_URL (default http://localhost:3001/api) and Confluence
// with the Keychain token (docs/confluence/README.md). Dry run unless --write.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { ConfluenceRest, ConflictError, keychainToken } from '../lib/confluence-rest';
import { planDocCheck, type DocCheckInput, type DocCheckItem, type DocCheckOutput, type DocCheckProject } from '../../../shared/doc-check-run';
import { adfText, findGenerated, generated, normalizeForCompare, replaceGenerated, sectionContent, type AdfDoc } from '../../../shared/confluence-adf';
import { settingsContent } from '../../../shared/confluence-rollup';
import { resultsFilled } from '../../../shared/doc-evidence';
import { confluencePageId } from '../../../shared/confluence-migration';
import { defaultSettings } from '../../../shared/confluence-hub';
import { DOC_KEYS, type DocKey } from '../../../shared/doc-matrix';
import type { DocHealthResponse } from '../../../shared/types';
import { todayIso } from '../lib/doc-check';

const API = process.env.TASKMANAGER_API_URL || 'http://localhost:3001/api';
const EMAIL = process.env.CONFLUENCE_EMAIL || 'brice.fenger@minted.com';
// Scoped token → API gateway for requests; the site URL is only for links people click.
const API_BASE = process.env.CONFLUENCE_API || 'https://api.atlassian.com/ex/confluence/8414201f-d700-468c-8b6c-c46b3396d079';
const SITE = process.env.CONFLUENCE_SITE || 'https://minted.atlassian.net';
const PAGES = `${SITE}/wiki/spaces/PM/pages/`;
const DIR = resolve(__dirname, '../../../docs/confluence');
const MANIFEST = join(DIR, 'manifest.json');
const IGNORE = join(DIR, 'doc-check-ignore.json');
const STATE = join(DIR, 'state');

const readJson = <T>(path: string, fallback: T): T => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback);
const conf = new ConfluenceRest({ base: API_BASE, email: EMAIL, token: () => keychainToken(EMAIL) });

async function tm<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Actor': 'doc-check' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`TaskManager ${path} → ${res.status}`);
  return (await res.json()) as T;
}

function manifestIds(): Record<string, string> {
  const m = readJson<{ nodes: Record<string, { pageId: string | null }> }>(MANIFEST, { nodes: {} });
  return Object.fromEntries(Object.entries(m.nodes).filter(([, v]) => v.pageId).map(([k, v]) => [k, v.pageId as string]));
}

type ProjectSettingsRow = { id: string; doc_mode: 'full' | 'one_pager_only' | null; customer_facing: boolean; waivers: Record<string, string> | null };

async function snapshot(): Promise<DocCheckInput> {
  const ids = manifestIds();
  if (!ids.root) throw new Error('manifest has no root page id');
  const health = await tm<DocHealthResponse>('/docs/health');
  const projectRows = await tm<ProjectSettingsRow[]>('/projects');
  const items = await tm<DocCheckItem[]>('/roadmap');
  const tree = await conf.descendants(ids.root);

  const settings = new Map(projectRows.map((p) => [p.id, {
    doc_mode: p.doc_mode ?? 'full',
    customer_facing: Boolean(p.customer_facing),
    waivers: (p.waivers ?? {}) as Partial<Record<DocKey, string>>,
  }]));
  const projects: DocCheckProject[] = health.projects.map((p) => ({
    ...p,
    settings: settings.get(p.project_id) ?? defaultSettings({ stage: p.roadmap_stage ?? 'roadmap' }),
  }));
  const recordedPageIds: DocCheckInput['recordedPageIds'] = {};
  for (const p of health.projects) {
    for (const r of p.rows) {
      const id = confluencePageId(r.link);
      if (id && r.key !== 'hub') recordedPageIds[id] = { project_id: p.project_id, key: r.key };
    }
  }
  return {
    today: todayIso(),
    base: PAGES,
    tree: [{ id: ids.root, title: 'Roadmap Projects', parentId: null, status: 'current' }, ...tree],
    manifest: ids,
    projects,
    items,
    recordedPageIds,
    ignored: readJson<string[]>(IGNORE, []),
  };
}

/** The results half of an experiment brief lives on the plan's page (spec §1); plan D6 decides "filled". */
async function addResultsEvidence(inp: DocCheckInput, out: DocCheckOutput) {
  for (const p of inp.projects) {
    const plan = p.rows.find((r) => r.key === 'experiment_brief.plan');
    const results = p.rows.find((r) => r.key === 'experiment_brief.results');
    const id = confluencePageId(plan?.link ?? out.evidence[p.project_id]?.['experiment_brief.plan']?.page_url);
    if (!id || !results || ['done', 'waived', 'inactive'].includes(results.status)) continue;
    const page = await conf.getAdf(id);
    (out.evidence[p.project_id] ??= {})['experiment_brief.results'] = {
      page_url: `${PAGES}${id}`,
      published: page.status === 'current',
      results_filled: resultsFilled(page.body),
    };
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(normalizeForCompare(a)) === JSON.stringify(normalizeForCompare(b));

/** Path and both values at the first difference, for `run --diff`. */
function firstDiff(a: unknown, b: unknown, path = ''): string | null {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const k of keys) {
      const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}/${k}`);
      if (d) return d;
    }
  }
  return `${path || '/'}: page has ${JSON.stringify(a)?.slice(0, 120)}, check wants ${JSON.stringify(b)?.slice(0, 120)}`;
}


async function run(write: boolean, diff = false) {
  let inp = await snapshot();
  let out = planDocCheck(inp);
  await addResultsEvidence(inp, out);
  const evidence = out.evidence;
  const evidenceCount = Object.values(evidence).reduce((n, e) => n + Object.keys(e).length, 0);
  if (write && evidenceCount) {
    for (const [project_id, ev] of Object.entries(evidence)) await tm('/docs/apply', { project_id, evidence: ev });
    // Re-read so checklists and roll-ups show the statuses the new evidence produced.
    inp = await snapshot();
    out = planDocCheck(inp);
  }

  let changed = 0;
  let unchanged = 0;
  const skipped: string[] = [];
  const changedPages: string[] = [];
  for (const w of out.writes) {
    try {
      const page = await conf.getAdf(w.page_id);
      const current = sectionContent(page.body, w.section);
      if (current === null) {
        skipped.push(`${w.page_id} ${w.section}: marker ${findGenerated(page.body, w.section).length ? 'duplicated' : 'missing'}`);
        continue;
      }
      if (same(current, w.content)) { unchanged++; continue; }
      changedPages.push(`${w.page_id} ${w.section} (${page.title})${diff ? `\n    ${firstDiff(normalizeForCompare(current), normalizeForCompare(w.content))}` : ''}`);
      changed++;
      if (!write) continue;
      const r = replaceGenerated(page.body, w.section, w.content);
      if (!r.replaced) { skipped.push(`${w.page_id} ${w.section}: ${r.reason}`); changed--; continue; }
      await conf.putAdf(w.page_id, { ...page, body: r.doc });
    } catch (e) {
      skipped.push(`${w.page_id} ${w.section}: ${e instanceof ConflictError ? 'edited by someone else, retry tomorrow' : (e as Error).message}`);
    }
  }

  console.log(out.markdown);
  const evidenceVerb = write ? 'recorded' : 'to record';
  const writeVerb = write ? 'written' : 'to write';
  console.log(`\n_Doc check: ${evidenceCount} docs ${evidenceVerb}, ${out.proposals.length} to confirm, ${changed} sections ${writeVerb} (${unchanged} unchanged, ${skipped.length} skipped)._`);
  if (!write) for (const c of changedPages) console.log(`- would write ${c}`);
  if (!write) for (const [pid, ev] of Object.entries(evidence)) console.log(`- would record ${Object.keys(ev).join(', ')} on ${pid}`);
  for (const s of skipped) console.log(`- skipped ${s}`);
  if (write) {
    mkdirSync(STATE, { recursive: true });
    writeFileSync(join(STATE, `${inp.today}.json`), JSON.stringify({ evidence, proposals: out.proposals, flags: out.flags, changed, unchanged, skipped }, null, 2) + '\n');
  }
}

async function accept(projectId: string, key: string, pageId: string) {
  if (!DOC_KEYS.includes(key as DocKey)) throw new Error(`unknown doc key: ${key}`);
  const page = await conf.getAdf(pageId);
  await tm('/docs/apply', { project_id: projectId, evidence: { [key]: { page_url: `${PAGES}${pageId}`, published: page.status === 'current' } } });
  console.log(`recorded "${page.title}" as ${key} on ${projectId}`);
}

function ignore(pageId: string) {
  const list = readJson<string[]>(IGNORE, []);
  if (!list.includes(pageId)) writeFileSync(IGNORE, JSON.stringify([...list, pageId], null, 2) + '\n');
  console.log(`ignoring ${pageId}`);
}

/** One-time: wrap each hub's hand-written Settings paragraph + table in a generated section (plan D4). */
async function migrateSettings(write: boolean) {
  const inp = await snapshot();
  const hubs = Object.entries(inp.manifest).filter(([k]) => k.startsWith('hub:')).map(([, v]) => v);
  for (const p of inp.projects) {
    const id = confluencePageId(p.hub_url);
    if (id && !hubs.includes(id)) hubs.push(id);
  }
  for (const id of hubs) {
    const page = await conf.getAdf(id);
    const label = `${id} (${page.title})`;
    if (findGenerated(page.body, 'settings').length) { console.log(`${label}: already migrated`); continue; }
    const c = page.body.content;
    const at = c.findIndex((n) => n.type === 'heading' && adfText(n).trim() === 'Settings');
    if (at < 0 || c[at + 1]?.type !== 'paragraph' || c[at + 2]?.type !== 'table') {
      console.log(`${label}: Settings section not in the expected shape, skipped`);
      continue;
    }
    const project = inp.projects.find((p) => confluencePageId(p.hub_url) === id);
    const item = inp.items.find((i) => inp.manifest[`hub:${i.id}`] === id);
    const block = generated('settings', settingsContent(project?.settings ?? defaultSettings({ stage: item?.stage ?? 'roadmap' })));
    const body: AdfDoc = { ...page.body, content: [...c.slice(0, at + 1), block, ...c.slice(at + 3)] };
    console.log(`${label}: ${write ? 'migrated' : 'would migrate'}`);
    if (write) await conf.putAdf(id, { ...page, body });
  }
}

const [cmd, ...args] = process.argv.slice(2);
const write = args.includes('--write');
(async () => {
  if (cmd === 'run') await run(write, args.includes('--diff'));
  else if (cmd === 'accept') await accept(args[0], args[1], args[2]);
  else if (cmd === 'ignore') ignore(args[0]);
  else if (cmd === 'migrate-settings') await migrateSettings(write);
  else throw new Error('usage: run [--write] | accept <projectId> <docKey> <pageId> | ignore <pageId> | migrate-settings [--write]');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

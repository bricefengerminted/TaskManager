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

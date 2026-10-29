// Client for the roadmap tool's POST /links (roadmap-tool functions/roadmap-api.js).
// Requests run one at a time, like ConfluenceRest. The write token is read from disk per
// request and never logged.

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export const ROADMAP_API = process.env.ROADMAP_API_URL || 'https://us-central1-roadmapping-tool-41423.cloudfunctions.net/roadmapApi';
export const ROADMAP_TOKEN_FILE = join(homedir(), '.config/roadmap-mcp/write-token');

/** Fields POST /links accepts today. figma and jiraEpic wait on the roadmap-tool change. */
export const API_WRITABLE_FIELDS = new Set(['prd', 'releaseNotes', 'hub', 'onePager', 'experimentBrief']);
const MAX_CHANGES_PER_REQUEST = 50;

export interface LinkChange { itemId: string; field: string; expected: string | null; value: string; overwriteApprovedBy?: string }
export type LinkResultKind = 'applied' | 'would-apply' | 'conflict' | 'needs-approval' | 'unchanged' | 'not-found';
export interface LinkResult { index: number; itemId: string; field: string; result: LinkResultKind; currentValue?: string | null; newValue?: string }

export function fileToken(path = ROADMAP_TOKEN_FILE): string {
  return readFileSync(path, 'utf8').trim();
}

export class RoadmapLinksClient {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private opts: { base?: string; token: () => string; fetch?: typeof fetch }) {}

  private post(body: unknown): Promise<{ dryRun: boolean; applied: number; results: LinkResult[] }> {
    const run = async () => {
      const res = await (this.opts.fetch ?? fetch)(`${this.opts.base ?? ROADMAP_API}/links`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.opts.token()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`roadmap POST /links → ${res.status} ${(await res.text()).slice(0, 300)}`.trim());
      return (await res.json()) as { dryRun: boolean; applied: number; results: LinkResult[] };
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Dry run unless dryRun is false. Results come back in the order of `changes`. */
  async updateLinks(actor: string, changes: LinkChange[], dryRun: boolean): Promise<LinkResult[]> {
    const out: LinkResult[] = [];
    for (let i = 0; i < changes.length; i += MAX_CHANGES_PER_REQUEST) {
      const chunk = changes.slice(i, i + MAX_CHANGES_PER_REQUEST);
      const r = await this.post({ actor, dryRun, changes: chunk });
      out.push(...r.results.map((x) => ({ ...x, index: x.index + i })));
    }
    return out;
  }
}

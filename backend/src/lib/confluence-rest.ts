// Minimal Confluence Cloud REST v2 client for the doc check. Requests run one at a time:
// the Atlassian MCP has a concurrency bug, and there's no reason to risk it here either.
// The token is scoped, so `base` is the API gateway (see docs/confluence/README.md).

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
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      });
      if (res.status === 409) throw new ConflictError(`409 on ${path}`);
      if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${(await res.text()).slice(0, 300)}`.trim());
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
        id,
        status: page.status,
        title: page.title,
        body: { representation: 'atlas_doc_format', value: JSON.stringify(page.body) },
        // Drafts have a single version that is overwritten in place.
        version: { number: page.status === 'draft' ? page.version : page.version + 1, message: 'Doc check' },
      }),
    });
  }
}

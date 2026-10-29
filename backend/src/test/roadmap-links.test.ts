import { describe, it, expect, vi } from 'vitest';
import { sameLink, taskManagerLinks } from '../../../shared/roadmap-links';
import { RoadmapLinksClient } from '../lib/roadmap-links-client';

const page = (id: string) => `https://minted.atlassian.net/wiki/spaces/PM/pages/${id}`;

describe('taskManagerLinks', () => {
  it('prefers recorded evidence, then the task link, then the project URL', () => {
    const links = taskManagerLinks({
      hub_url: page('1'),
      one_pager_url: null,
      tasks: [
        { doc_key: 'prd', doc_evidence: JSON.stringify({ page_url: page('2') }), links: [{ url: page('3') }] },
        { doc_key: 'experiment_brief.plan', doc_evidence: null, links: [{ url: 'artifacts/local.md' }, { url: page('4') }] },
        { doc_key: 'figma', doc_evidence: '{bad json', links: [] },
        { doc_key: 'research', doc_evidence: JSON.stringify({ page_url: page('5') }) },
      ],
    });
    expect(links).toEqual({ prd: page('2'), 'experiment_brief.plan': page('4'), hub: page('1') });
  });
});

describe('sameLink', () => {
  it('compares Confluence links by page id and others by URL', () => {
    expect(sameLink(page('7'), `${page('7')}/Some+Title`)).toBe(true);
    expect(sameLink(page('7'), page('8'))).toBe(false);
    expect(sameLink('https://www.figma.com/file/a/', 'https://www.figma.com/file/a')).toBe(true);
    expect(sameLink('https://www.figma.com/file/a', 'https://www.figma.com/file/b')).toBe(false);
  });
});

describe('RoadmapLinksClient', () => {
  it('posts one request at a time in chunks of 50 and keeps result order', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const bodies: { actor: string; dryRun: boolean; changes: unknown[] }[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      const results = body.changes.map((c: { itemId: string; field: string }, index: number) => ({ index, ...c, result: 'would-apply' }));
      return new Response(JSON.stringify({ dryRun: body.dryRun, applied: 0, results }), { status: 200 });
    });
    const client = new RoadmapLinksClient({ base: 'https://api.test', token: () => 'tok', fetch: fetchMock as unknown as typeof fetch });
    const changes = Array.from({ length: 60 }, (_, i) => ({ itemId: `i${i}`, field: 'prd', expected: null, value: page(String(i)) }));
    const results = await client.updateLinks('brice.fenger@minted.com', changes, true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(1);
    expect(bodies.map((b) => b.changes.length)).toEqual([50, 10]);
    expect(bodies.every((b) => b.dryRun === true && b.actor === 'brice.fenger@minted.com')).toBe(true);
    expect(results.map((r) => r.index)).toEqual(changes.map((_, i) => i));
    expect(results[55].itemId).toBe('i55');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/links');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('throws on an HTTP error', async () => {
    const fetchMock = vi.fn(async () => new Response('bad field', { status: 400 }));
    const client = new RoadmapLinksClient({ base: 'https://api.test', token: () => 'tok', fetch: fetchMock as unknown as typeof fetch });
    await expect(client.updateLinks('a@b.co', [{ itemId: 'x', field: 'prd', expected: null, value: page('1') }], false)).rejects.toThrow('400 bad field');
  });
});

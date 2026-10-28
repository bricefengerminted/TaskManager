import { describe, it, expect, vi, afterEach } from 'vitest';
import { ConfluenceRest, ConflictError } from '../lib/confluence-rest';

afterEach(() => { vi.unstubAllGlobals(); });

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
const client = () => new ConfluenceRest({ base: 'https://x', email: 'e', token: () => 't' });

describe('ConfluenceRest', () => {
  it('never overlaps requests', async () => {
    let inFlight = 0;
    let max = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return json({ id: '1', title: 't', status: 'current', version: { number: 3 }, body: { atlas_doc_format: { value: '{"type":"doc","version":1,"content":[]}' } } });
    }));
    const c = client();
    await Promise.all([c.getAdf('1'), c.getAdf('2'), c.getAdf('3')]);
    expect(max).toBe(1);
  });

  it('keeps going after a failed request', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({}, 500))
      .mockResolvedValueOnce(json({ id: '2', title: 'T', status: 'current', version: { number: 1 }, body: { atlas_doc_format: { value: '{"type":"doc","version":1,"content":[]}' } } })));
    const c = client();
    await expect(c.getAdf('1')).rejects.toThrow('500');
    expect((await c.getAdf('2')).title).toBe('T');
  });

  it('pages through descendants', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ results: [{ id: 'a', title: 'A', parentId: 'r', status: 'current' }], _links: { next: '/wiki/api/v2/pages/r/descendants?cursor=2' } }))
      .mockResolvedValueOnce(json({ results: [{ id: 'b', title: 'B', parentId: 'a', status: 'draft' }], _links: {} })));
    expect((await client().descendants('r')).map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('bumps the version and maps 409 to ConflictError', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({}, 409));
    vi.stubGlobal('fetch', fetchMock);
    await expect(client().putAdf('1', { version: 3, title: 'T', status: 'current', body: { type: 'doc', version: 1, content: [] } }))
      .rejects.toBeInstanceOf(ConflictError);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).version.number).toBe(4);
  });
});

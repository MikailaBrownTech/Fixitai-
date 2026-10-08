import { describe, expect, it, vi } from 'vitest';
import type { ParsedEntities } from '@fixitfast/shared';
import { createUpstreamClient } from '../src/upstream/http';
import { IFIXIT_API_BASE, buildSearchQuery, createIfixitCatalog } from '../src/upstream/ifixit';

const entities: ParsedEntities = {
  applianceType: 'dryer',
  brand: 'Whirlpool',
  modelNumber: 'WED4815EW',
  part: 'heating element',
};

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

function setup(respond: (url: URL) => Response | Promise<Response>) {
  const fetchImpl = vi.fn<typeof fetch>(async (input) => respond(input as URL));
  const catalog = createIfixitCatalog(createUpstreamClient({ baseUrl: IFIXIT_API_BASE, fetchImpl }));
  return { catalog, fetchImpl };
}

const guideResult = {
  dataType: 'guide',
  title: 'Dryer Heating Element Replacement',
  summary: 'Replace the element.',
  url: 'https://www.ifixit.com/Guide/Dryer+Heating+Element+Replacement/1',
  image: { thumbnail: 'https://guide-images.cdn.ifixit.com/igi/abc.thumbnail' },
};

describe('buildSearchQuery', () => {
  it('joins the entities that were found', () => {
    expect(buildSearchQuery(entities)).toBe('Whirlpool dryer WED4815EW heating element');
  });

  it('skips nulls', () => {
    expect(buildSearchQuery({ applianceType: 'dryer', brand: null, modelNumber: null, part: 'belt' })).toBe('dryer belt');
  });

  it('never exceeds 100 characters', () => {
    const long = { applianceType: 'refrigerator', brand: 'B'.repeat(40), modelNumber: 'M'.repeat(30), part: 'p'.repeat(60) } as ParsedEntities;
    expect(buildSearchQuery(long).length).toBeLessThanOrEqual(100);
  });
});

describe('the request we send', () => {
  it('calls GET /api/2.0/suggest/<encoded phrase>?doctypes=guide,item on the iFixit host', async () => {
    const { catalog, fetchImpl } = setup(() => json({ query: 'q', results: [] }));
    await catalog.search(entities);

    const url = fetchImpl.mock.calls[0]![0] as URL;
    expect(url.origin).toBe('https://www.ifixit.com');
    expect(url.pathname).toBe('/api/2.0/suggest/Whirlpool%20dryer%20WED4815EW%20heating%20element');
    expect(url.searchParams.get('doctypes')).toBe('guide,item');
    expect([...url.searchParams.keys()]).toEqual(['doctypes']);
  });

  it('a slash or quote in a part name stays inside the path segment', async () => {
    const { catalog, fetchImpl } = setup(() => json({ results: [] }));
    await catalog.search({ ...entities, part: "door/lid o'ring" });
    const url = fetchImpl.mock.calls[0]![0] as URL;
    expect(url.pathname.startsWith('/api/2.0/suggest/')).toBe(true);
    expect(url.pathname.split('/').length).toBe(5); // "", api, 2.0, suggest, <one segment>
    expect(url.search).toBe('?doctypes=guide%2Citem');
  });
});

describe('mapping results', () => {
  it('puts guides in guides and items in parts, and drops other types', async () => {
    const { catalog } = setup(() =>
      json({
        results: [
          guideResult,
          { ...guideResult, dataType: 'item', title: 'Heating element kit', url: 'https://www.ifixit.com/products/heating-element' },
          { ...guideResult, dataType: 'topic', title: 'A topic' },
          { ...guideResult, dataType: 'question', title: 'A question' },
        ],
      }),
    );
    const result = await catalog.search(entities);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.data.guides.map((g) => g.title)).toEqual(['Dryer Heating Element Replacement']);
    expect(result.data.parts.map((p) => p.title)).toEqual(['Heating element kit']);
    expect(result.data.guides[0]).toEqual({
      title: 'Dryer Heating Element Replacement',
      url: 'https://www.ifixit.com/Guide/Dryer+Heating+Element+Replacement/1',
      summary: 'Replace the element.',
      imageUrl: 'https://guide-images.cdn.ifixit.com/igi/abc.thumbnail',
    });
  });

  it('drops a single bad item instead of failing the whole response', async () => {
    const { catalog } = setup(() => json({ results: [{ nonsense: true }, 42, null, guideResult] }));
    const result = await catalog.search(entities);
    expect(result).toMatchObject({ ok: true, data: { guides: [{ title: 'Dryer Heating Element Replacement' }] } });
  });

  it.each([
    ['a javascript: link', 'javascript:alert(1)'],
    ['an http link', 'http://www.ifixit.com/Guide/x/1'],
    ['a look-alike host', 'https://ifixit.com.evil.test/Guide/x/1'],
    ['another site', 'https://evil.test/Guide/x/1'],
  ])('drops a result with %s', async (_label, url) => {
    const { catalog } = setup(() => json({ results: [{ ...guideResult, url }] }));
    expect(await catalog.search(entities)).toEqual({ ok: true, data: { guides: [], parts: [] } });
  });

  it('keeps the result but nulls an untrusted image URL', async () => {
    const { catalog } = setup(() => json({ results: [{ ...guideResult, image: { thumbnail: 'https://evil.test/x.png' } }] }));
    const result = await catalog.search(entities);
    expect(result).toMatchObject({ ok: true, data: { guides: [{ imageUrl: null }] } });
  });

  it('accepts null summary and null image', async () => {
    const { catalog } = setup(() => json({ results: [{ ...guideResult, summary: null, image: null }] }));
    const result = await catalog.search(entities);
    expect(result).toMatchObject({ ok: true, data: { guides: [{ summary: null, imageUrl: null }] } });
  });

  it('caps title and summary length and keeps markup as literal text (the frontend must render text)', async () => {
    const { catalog } = setup(() =>
      json({ results: [{ ...guideResult, title: '<img src=x onerror=alert(1)>' + 'a'.repeat(500), summary: 's'.repeat(1000) }] }),
    );
    const result = await catalog.search(entities);
    if (!result.ok) throw new Error('expected ok');
    const [g] = result.data.guides;
    expect(g!.title.length).toBe(200);
    expect(g!.title.startsWith('<img src=x onerror=alert(1)>')).toBe(true);
    expect(g!.summary!.length).toBe(300);
  });

  it('returns at most 10 per list', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ ...guideResult, title: `Guide ${i}` }));
    const { catalog } = setup(() => json({ results: many }));
    const result = await catalog.search(entities);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.guides).toHaveLength(10);
  });

  it('an empty results array is a normal "nothing found"', async () => {
    const { catalog } = setup(() => json({ query: 'x', results: [] }));
    expect(await catalog.search(entities)).toEqual({ ok: true, data: { guides: [], parts: [] } });
  });
});

describe('failures pass through as reason codes', () => {
  it.each([
    [() => new Response('bad gateway', { status: 502 }), 'upstream_error'],
    [() => new Response('slow down', { status: 429 }), 'rate_limited'],
    [() => json({ results: 'not an array' }), 'bad_response'],
    [() => json({ nothing: 1 }), 'bad_response'],
    [() => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }), 'bad_response'],
  ])('maps to %#', async (respond, reason) => {
    const { catalog } = setup(respond);
    expect(await catalog.search(entities)).toEqual({ ok: false, reason });
  });
});

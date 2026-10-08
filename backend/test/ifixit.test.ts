import { describe, expect, it, vi } from 'vitest';
import type { ParsedEntities } from '@fixitfast/shared';
import { createUpstreamClient } from '../src/upstream/http';
import { IFIXIT_API_BASE, buildSearchPlan, createIfixitCatalog } from '../src/upstream/ifixit';

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
const callsOf = (fetchImpl: ReturnType<typeof setup>['fetchImpl']) =>
  fetchImpl.mock.calls.map(([input]) => {
    const url = input as URL;
    return { doctypes: url.searchParams.get('doctypes'), phrase: decodeURIComponent(url.pathname.split('/')[4] ?? '') };
  });

// Shapes copied from real iFixit responses captured with backend/scripts/ifixit-probe.ts.
const guideResult = {
  dataType: 'guide',
  title: 'Dryer Heating Element Replacement',
  summary: 'Replace the element.',
  url: 'https://www.ifixit.com/Guide/Dryer+Heating+Element+Replacement/1',
  image: { thumbnail: 'https://guide-images.cdn.ifixit.com/igi/abc.thumbnail' },
};
const itemResult = {
  dataType: 'wiki',
  namespace: 'ITEM',
  title: 'DC66-10170B - Samsung Washer Belt',
  url: 'https://www.ifixit.com/Item/DC66-10170B_-_Samsung_Washer_Belt',
};

/** Answers item queries with `items` and guide queries with `guides`. */
const byDoctype = (items: unknown[], guides: unknown[]) => (url: URL) =>
  json({ query: 'q', results: url.searchParams.get('doctypes') === 'item' ? items : guides });

describe('buildSearchPlan', () => {
  it('asks for parts twice (specific, then broad) and guides once with the short phrase', () => {
    expect(buildSearchPlan(entities)).toEqual({
      items: ['Whirlpool dryer heating element', 'dryer heating element'],
      guides: ['dryer heating element'],
    });
  });

  it('does not use the model number', () => {
    const plan = buildSearchPlan(entities);
    expect(JSON.stringify(plan)).not.toContain('WED4815EW');
  });

  it('without a brand there is just one parts query (no duplicate calls)', () => {
    expect(buildSearchPlan({ ...entities, brand: null })).toEqual({
      items: ['dryer heating element'],
      guides: ['dryer heating element'],
    });
  });

  it('without a part, uses brand + appliance and never a bare appliance name', () => {
    expect(buildSearchPlan({ ...entities, part: null })).toEqual({ items: ['Whirlpool dryer'], guides: ['Whirlpool dryer'] });
    expect(buildSearchPlan({ applianceType: 'dryer', brand: null, modelNumber: null, part: null })).toEqual({
      items: ['dryer'],
      guides: ['dryer'],
    });
  });

  it('with only a model number there is nothing to ask', () => {
    expect(buildSearchPlan({ applianceType: null, brand: null, modelNumber: 'WED4815EW', part: null })).toEqual({ items: [], guides: [] });
  });

  it('never exceeds 100 characters per phrase', () => {
    const long = { applianceType: 'refrigerator', brand: 'B'.repeat(40), modelNumber: null, part: 'p'.repeat(60) } as ParsedEntities;
    const plan = buildSearchPlan(long);
    for (const p of [...plan.items, ...plan.guides]) expect(p.length).toBeLessThanOrEqual(100);
  });
});

describe('the requests we send', () => {
  it('sends three GETs to the iFixit suggest endpoint: two for items, one for guides', async () => {
    const { catalog, fetchImpl } = setup(byDoctype([], []));
    await catalog.search(entities);

    expect(callsOf(fetchImpl)).toEqual([
      { doctypes: 'item', phrase: 'Whirlpool dryer heating element' },
      { doctypes: 'item', phrase: 'dryer heating element' },
      { doctypes: 'guide', phrase: 'dryer heating element' },
    ]);
    for (const [input] of fetchImpl.mock.calls) {
      const url = input as URL;
      expect(url.origin).toBe('https://www.ifixit.com');
      expect(url.pathname.startsWith('/api/2.0/suggest/')).toBe(true);
      expect([...url.searchParams.keys()]).toEqual(['doctypes']);
    }
  });

  it('a slash or quote in a part name stays inside the path segment', async () => {
    const { catalog, fetchImpl } = setup(byDoctype([], []));
    await catalog.search({ ...entities, part: "door/lid o'ring" });
    for (const [input] of fetchImpl.mock.calls) {
      const url = input as URL;
      expect(url.pathname.split('/').length).toBe(5); // "", api, 2.0, suggest, <one segment>
    }
  });

  it('sends nothing when there is nothing to ask', async () => {
    const { catalog, fetchImpl } = setup(byDoctype([], []));
    const result = await catalog.search({ applianceType: null, brand: null, modelNumber: 'WED4815EW', part: null });
    expect(result).toEqual({ ok: true, data: { guides: [], parts: [] } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('mapping results', () => {
  it('wiki results in the ITEM namespace are parts, guides are guides', async () => {
    const { catalog } = setup(byDoctype([itemResult], [guideResult]));
    const result = await catalog.search(entities);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.parts).toEqual([
      { title: 'DC66-10170B - Samsung Washer Belt', url: itemResult.url, summary: null, imageUrl: null },
    ]);
    expect(result.data.guides.map((g) => g.title)).toEqual(['Dryer Heating Element Replacement']);
    expect(result.data.guides[0]).toEqual({
      title: 'Dryer Heating Element Replacement',
      url: 'https://www.ifixit.com/Guide/Dryer+Heating+Element+Replacement/1',
      summary: 'Replace the element.',
      imageUrl: 'https://guide-images.cdn.ifixit.com/igi/abc.thumbnail',
    });
  });

  it.each([
    ['a wiki page outside the ITEM namespace', { ...itemResult, namespace: 'USER' }],
    ['a wiki result with no namespace', { ...itemResult, namespace: undefined }],
    ['a lower-case namespace (not the shape we observed)', { ...itemResult, namespace: 'item' }],
    ['an unobserved "item" dataType', { ...itemResult, dataType: 'item' }],
    ['a topic', { ...guideResult, dataType: 'topic' }],
    ['a question', { ...guideResult, dataType: 'question' }],
  ])('drops %s', async (_label, odd) => {
    const { catalog } = setup(byDoctype([odd], [odd]));
    expect(await catalog.search(entities)).toEqual({ ok: true, data: { guides: [], parts: [] } });
  });

  it('the same part found by both part queries is listed once, in the most specific query\'s position', async () => {
    const other = { ...itemResult, title: 'Other belt', url: 'https://www.ifixit.com/Item/Other' };
    const { catalog } = setup((url) => {
      const phrase = decodeURIComponent(url.pathname.split('/')[4] ?? '');
      if (url.searchParams.get('doctypes') === 'guide') return json({ results: [] });
      return json({ results: phrase.startsWith('Whirlpool') ? [itemResult] : [other, itemResult] });
    });
    const result = await catalog.search(entities);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.parts.map((p) => p.title)).toEqual(['DC66-10170B - Samsung Washer Belt', 'Other belt']);
  });

  it('drops a single bad item instead of failing the whole response', async () => {
    const { catalog } = setup(byDoctype([], [{ nonsense: true }, 42, null, guideResult]));
    const result = await catalog.search(entities);
    expect(result).toMatchObject({ ok: true, data: { guides: [{ title: 'Dryer Heating Element Replacement' }] } });
  });

  it.each([
    ['a javascript: link', 'javascript:alert(1)'],
    ['an http link', 'http://www.ifixit.com/Item/x'],
    ['a look-alike host', 'https://ifixit.com.evil.test/Item/x'],
    ['another site', 'https://evil.test/Item/x'],
  ])('drops a part or guide with %s', async (_label, url) => {
    const { catalog } = setup(byDoctype([{ ...itemResult, url }], [{ ...guideResult, url }]));
    expect(await catalog.search(entities)).toEqual({ ok: true, data: { guides: [], parts: [] } });
  });

  it('keeps the result but nulls an untrusted image URL', async () => {
    const { catalog } = setup(byDoctype([], [{ ...guideResult, image: { thumbnail: 'https://evil.test/x.png' } }]));
    const result = await catalog.search(entities);
    expect(result).toMatchObject({ ok: true, data: { guides: [{ imageUrl: null }] } });
  });

  it('accepts null summary and null image', async () => {
    const { catalog } = setup(byDoctype([], [{ ...guideResult, summary: null, image: null }]));
    const result = await catalog.search(entities);
    expect(result).toMatchObject({ ok: true, data: { guides: [{ summary: null, imageUrl: null }] } });
  });

  it('caps title and summary length and keeps markup as literal text (the frontend must render text)', async () => {
    const hostile = { ...itemResult, title: '<img src=x onerror=alert(1)>' + 'a'.repeat(500), summary: 's'.repeat(1000) };
    const { catalog } = setup(byDoctype([hostile], []));
    const result = await catalog.search(entities);
    if (!result.ok) throw new Error('expected ok');
    const [p] = result.data.parts;
    expect(p!.title.length).toBe(200);
    expect(p!.title.startsWith('<img src=x onerror=alert(1)>')).toBe(true);
    expect(p!.summary!.length).toBe(300);
  });

  it('returns at most 10 per list', async () => {
    const many = (base: object) => Array.from({ length: 25 }, (_, i) => ({ ...base, title: `T ${i}`, url: `https://www.ifixit.com/x/${i}` }));
    const { catalog } = setup(byDoctype(many(itemResult), many(guideResult)));
    const result = await catalog.search(entities);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.parts).toHaveLength(10);
    expect(result.data.guides).toHaveLength(10);
  });

  it('empty results arrays are a normal "nothing found"', async () => {
    const { catalog } = setup(byDoctype([], []));
    expect(await catalog.search(entities)).toEqual({ ok: true, data: { guides: [], parts: [] } });
  });
});

describe('failures', () => {
  it.each([
    [() => new Response('bad gateway', { status: 502 }), 'upstream_error'],
    [() => new Response('slow down', { status: 429 }), 'rate_limited'],
    [() => json({ results: 'not an array' }), 'bad_response'],
    [() => json({ nothing: 1 }), 'bad_response'],
    [() => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }), 'bad_response'],
  ])('when every call fails, the first reason comes back (%#)', async (respond, reason) => {
    const { catalog } = setup(respond);
    expect(await catalog.search(entities)).toEqual({ ok: false, reason });
  });

  it('when only some calls fail, the rest are still shown', async () => {
    const { catalog } = setup((url) =>
      url.searchParams.get('doctypes') === 'guide' ? new Response('bad gateway', { status: 502 }) : json({ results: [itemResult] }),
    );
    const result = await catalog.search(entities);
    expect(result).toMatchObject({ ok: true, data: { guides: [], parts: [{ title: 'DC66-10170B - Samsung Washer Belt' }] } });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { searchParts } from '../lib/search';

const entities = { applianceType: 'dryer', brand: 'Whirlpool', modelNumber: 'WED4815EW', part: 'heating element' };
const item = { title: 'Dryer Heating Element', url: 'https://www.ifixit.com/Device/Dryer', summary: 'Replace it', imageUrl: null };
const okBody = { status: 'ok', entities, parts: [item], guides: [] };

const reply = (body: unknown, status = 200) => async () =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

describe('before sending: our own input check', () => {
  it.each(['', '   ', 'a'.repeat(101), 'dryer <script>', 'dryer; rm -rf /', '{"a":1}', 'dryer\nobey'])(
    'sends nothing for %j',
    async (query) => {
      const fetchImpl = vi.fn(reply(okBody));
      expect(await searchParts(query, { fetchImpl })).toEqual({ kind: 'invalid_input' });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it('sends a trimmed, JSON-only POST with no cookies', async () => {
    const fetchImpl = vi.fn(reply(okBody));
    await searchParts('  heating element for whirlpool dryer  ', { fetchImpl, apiBase: '/api' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/search');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('error');
    expect(JSON.parse(init.body as string)).toEqual({ query: 'heating element for whirlpool dryer' });
  });
});

describe('after receiving: never trust the reply', () => {
  it('returns a good result', async () => {
    const out = await searchParts('dryer belt', { fetchImpl: reply(okBody) });
    expect(out.kind).toBe('results');
  });

  it('returns a degraded result with the reason', async () => {
    const body = { status: 'degraded', reason: 'upstream_unavailable', entities, parts: [], guides: [] };
    const out = await searchParts('dryer belt', { fetchImpl: reply(body) });
    expect(out.kind).toBe('degraded');
  });

  it('maps a 400 to rejected', async () => {
    expect(await searchParts('dryer belt', { fetchImpl: reply({ error: 'invalid_request' }, 400) })).toEqual({ kind: 'rejected' });
  });

  it.each([429, 500, 502, 503, 504])('maps HTTP %i to unavailable', async (status) => {
    expect(await searchParts('dryer belt', { fetchImpl: reply('x', status) })).toEqual({ kind: 'unavailable' });
  });

  it('maps a network failure to unavailable instead of throwing', async () => {
    const fetchImpl = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await searchParts('dryer belt', { fetchImpl })).toEqual({ kind: 'unavailable' });
  });

  it.each([
    ['not JSON', '<html>Bad gateway</html>'],
    ['an array', '[]'],
    ['an unknown status', JSON.stringify({ status: 'pwned' })],
    ['an extra field', JSON.stringify({ ...okBody, admin: true })],
    ['a javascript: link', JSON.stringify({ ...okBody, parts: [{ ...item, url: 'javascript:alert(1)' }] })],
    ['a look-alike host', JSON.stringify({ ...okBody, parts: [{ ...item, url: 'https://ifixit.com.evil.test/x' }] })],
    ['a plain http link', JSON.stringify({ ...okBody, parts: [{ ...item, url: 'http://www.ifixit.com/x' }] })],
    ['a tracking image on another site', JSON.stringify({ ...okBody, parts: [{ ...item, imageUrl: 'https://evil.test/p.png' }] })],
    ['a huge body', 'x'.repeat(300_000)],
  ])('treats %s as unavailable', async (_label, body) => {
    expect(await searchParts('dryer belt', { fetchImpl: reply(body) })).toEqual({ kind: 'unavailable' });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createUpstreamClient } from '../src/upstream/http';

const BASE = 'https://api.example.test/api/2.0';
const schema = z.object({ items: z.array(z.object({ title: z.string() })) });
const goodBody = JSON.stringify({ items: [{ title: 'Dryer heating element' }] });

const json = (body: string, init: ResponseInit = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'application/json' }, ...init });

type FetchFn = typeof fetch;

/** A fake fetch that records the URL and options it was called with. */
function setup(respond: (url: URL, init: RequestInit) => Promise<Response> | Response, opts = {}) {
  const fetchImpl = vi.fn<FetchFn>(async (input, init) => respond(input as URL, init ?? {}));
  const client = createUpstreamClient({ baseUrl: BASE, fetchImpl, ...opts });
  return { client, fetchImpl };
}

const get = (client: ReturnType<typeof createUpstreamClient>, segments = ['search', 'dryer']) =>
  client.getJson({ segments, schema });

describe('happy path', () => {
  it('returns validated data', async () => {
    const { client } = setup(() => json(goodBody));
    expect(await get(client)).toEqual({ ok: true, data: { items: [{ title: 'Dryer heating element' }] } });
  });

  it('drops unknown fields from third-party data but keeps what the schema names', async () => {
    const { client } = setup(() => json(JSON.stringify({ items: [{ title: 'x', secret: 'y' }], extra: 1 })));
    expect(await get(client)).toEqual({ ok: true, data: { items: [{ title: 'x' }] } });
  });

  it('sends a GET with no redirects and a timeout signal', async () => {
    const { client, fetchImpl } = setup(() => json(goodBody));
    await get(client);
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init.method).toBe('GET');
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

// Security requirement 4: upstream failures are caught and become a short code, never an exception.
describe('upstream failures degrade instead of throwing', () => {
  it.each([
    [500, 'upstream_error'],
    [502, 'upstream_error'],
    [503, 'upstream_error'],
    [429, 'rate_limited'],
    [404, 'not_found'],
    [403, 'bad_response'],
    [302, 'bad_response'],
  ])('HTTP %i -> %s', async (status, reason) => {
    const { client } = setup(() => new Response('whatever', { status }));
    expect(await get(client)).toEqual({ ok: false, reason });
  });

  it('a network error -> network', async () => {
    const { client } = setup(() => {
      throw new TypeError('fetch failed: ECONNRESET to https://api.example.test/?key=SECRET');
    });
    expect(await get(client)).toEqual({ ok: false, reason: 'network' });
  });

  it('a hung server -> timeout (the abort signal is honored)', async () => {
    const { client } = setup(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
        }),
      { timeoutMs: 30 },
    );
    expect(await get(client)).toEqual({ ok: false, reason: 'timeout' });
  });

  it('a redirect is never followed', async () => {
    const { client, fetchImpl } = setup(() => new Response(null, { status: 302, headers: { location: 'https://evil.test/' } }));
    expect(await get(client)).toEqual({ ok: false, reason: 'bad_response' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('untrusted response bodies', () => {
  it('rejects a body that is not JSON', async () => {
    const { client } = setup(() => json('<html>Bad gateway</html>'));
    expect(await get(client)).toEqual({ ok: false, reason: 'bad_response' });
  });

  it('rejects a response with the wrong content type', async () => {
    const { client } = setup(() => new Response(goodBody, { status: 200, headers: { 'content-type': 'text/html' } }));
    expect(await get(client)).toEqual({ ok: false, reason: 'bad_response' });
  });

  it('rejects JSON of the wrong shape', async () => {
    const { client } = setup(() => json(JSON.stringify({ items: 'not an array' })));
    expect(await get(client)).toEqual({ ok: false, reason: 'bad_response' });
  });

  it('rejects an oversized body announced by content-length, without reading it', async () => {
    const { client } = setup(() => json(goodBody, { headers: { 'content-type': 'application/json', 'content-length': '999999' } }), {
      maxBytes: 1000,
    });
    expect(await get(client)).toEqual({ ok: false, reason: 'too_large' });
  });

  it('rejects an oversized body that has no content-length (streamed past the cap)', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(400));
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk); // never ends on its own
      },
    });
    const { client } = setup(() => new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } }), {
      maxBytes: 1000,
    });
    expect(await get(client)).toEqual({ ok: false, reason: 'too_large' });
  });
});

// Security requirement 5: no string-built URLs. User text can only ever be DATA inside the URL.
describe('URLs are built, not concatenated', () => {
  it('encodes query values so they cannot add parameters, a fragment or a new path', async () => {
    const { client, fetchImpl } = setup(() => json(goodBody));
    const nasty = 'WED4815EW&admin=true#frag/../../x?y=1';
    await client.getJson({ segments: ['search'], query: { q: nasty }, schema });

    const url = fetchImpl.mock.calls[0]![0] as URL;
    expect(url.pathname).toBe('/api/2.0/search');
    expect(url.hash).toBe('');
    expect([...url.searchParams.keys()]).toEqual(['q']);
    expect(url.searchParams.get('q')).toBe(nasty);
  });

  it('encodes path segments so "/" and "?" stay inside one segment', async () => {
    const { client, fetchImpl } = setup(() => json(goodBody));
    await client.getJson({ segments: ['search', 'a/b?c=d'], schema });

    const url = fetchImpl.mock.calls[0]![0] as URL;
    expect(url.pathname).toBe('/api/2.0/search/a%2Fb%3Fc%3Dd');
    expect(url.search).toBe('');
  });

  it.each([[['..']], [['search', '..', 'admin']], [['.']], [['']]])(
    'refuses path-climbing or empty segments %j without calling out',
    async (segments) => {
      const { client, fetchImpl } = setup(() => json(goodBody));
      expect(await client.getJson({ segments, schema })).toEqual({ ok: false, reason: 'invalid_request' });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it('always stays on the configured host', async () => {
    const { client, fetchImpl } = setup(() => json(goodBody));
    await client.getJson({ segments: ['search', '//evil.test/x', '@evil.test'], schema });
    expect((fetchImpl.mock.calls[0]![0] as URL).origin).toBe('https://api.example.test');
  });

  it('refuses a non-https base URL at startup', () => {
    expect(() => createUpstreamClient({ baseUrl: 'http://api.example.test/api' })).toThrow('https');
  });
});

describe('no leaks', () => {
  it('returns only a short reason code, never error text, URLs or bodies', async () => {
    const { client } = setup(() => {
      throw new Error('boom https://api.example.test/?key=SECRET-KEY');
    });
    const result = await get(client);
    expect(JSON.stringify(result)).not.toContain('SECRET-KEY');
    expect(Object.keys(result)).toEqual(['ok', 'reason']);
  });
});

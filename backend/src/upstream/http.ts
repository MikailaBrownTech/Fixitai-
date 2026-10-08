import type { ZodType } from 'zod';

/**
 * Why a call to an outside service failed. The caller (the handler) maps any of these to a
 * "degraded" response. Only this short code ever leaves the module: never a message, a URL,
 * headers or a response body, so nothing from the outside world can leak into logs or replies.
 */
export type UpstreamFailure =
  | 'timeout'
  | 'rate_limited'
  | 'not_found'
  | 'upstream_error'
  | 'bad_response'
  | 'too_large'
  | 'network'
  | 'invalid_request';

export type UpstreamResult<T> = { ok: true; data: T } | { ok: false; reason: UpstreamFailure };

export interface UpstreamClientOptions {
  /** A FIXED https URL from our own config. It is never built from user input. */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  userAgent?: string;
}

export interface UpstreamClient {
  /**
   * GET a JSON document and validate it. NEVER throws: every failure comes back as a result.
   * `segments` are URL path pieces and `query` is key/value pairs. Both are encoded for us,
   * so user text can never change the shape of the URL (no string-built URLs).
   */
  getJson<T>(args: {
    segments: string[];
    query?: Record<string, string | number>;
    schema: ZodType<T>;
  }): Promise<UpstreamResult<T>>;
}

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_MAX_BYTES = 512 * 1024;

export function createUpstreamClient(options: UpstreamClientOptions): UpstreamClient {
  // Misconfiguration is a programming error, so it fails loudly at startup, not per request.
  const base = new URL(options.baseUrl);
  if (base.protocol !== 'https:') {
    throw new Error('Upstream baseUrl must use https');
  }
  const basePath = base.pathname.replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const userAgent = options.userAgent ?? 'FixItFast-portfolio/0.1';

  function buildUrl(segments: string[], query: Record<string, string | number> | undefined): URL | null {
    // "." and ".." would be resolved by the URL parser and could climb out of the API path.
    if (segments.some((s) => s === '' || s === '.' || s === '..')) return null;

    const url = new URL(`${basePath}/${segments.map(encodeURIComponent).join('/')}`, base.origin);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, String(value));
    }
    // Belt and braces: whatever happened above, we still talk to the same host.
    return url.origin === base.origin ? url : null;
  }

  /** Reads the body, but gives up as soon as it passes the size cap. */
  async function readCapped(res: Response): Promise<string | 'too_large'> {
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body?.cancel();
      return 'too_large';
    }
    if (!res.body) return '';

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        return 'too_large';
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  }

  return {
    async getJson<T>(args: {
      segments: string[];
      query?: Record<string, string | number>;
      schema: ZodType<T>;
    }): Promise<UpstreamResult<T>> {
      const { segments, query, schema } = args;
      const url = buildUrl(segments, query);
      if (!url) return { ok: false, reason: 'invalid_request' } as const;

      try {
        const res = await fetchImpl(url, {
          method: 'GET',
          // A redirect could send us to a different host. We refuse to follow any.
          redirect: 'manual',
          headers: { Accept: 'application/json', 'User-Agent': userAgent },
          // Covers waiting for headers AND reading the body.
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (res.status === 429) return { ok: false, reason: 'rate_limited' } as const;
        if (res.status === 404) return { ok: false, reason: 'not_found' } as const;
        if (res.status >= 500) return { ok: false, reason: 'upstream_error' } as const;
        if (res.status !== 200) return { ok: false, reason: 'bad_response' } as const; // 3xx, other 4xx

        if (!(res.headers.get('content-type') ?? '').toLowerCase().includes('json')) {
          return { ok: false, reason: 'bad_response' } as const;
        }

        const body = await readCapped(res);
        if (body === 'too_large') return { ok: false, reason: 'too_large' } as const;

        let json: unknown;
        try {
          json = JSON.parse(body);
        } catch {
          return { ok: false, reason: 'bad_response' } as const;
        }

        // Third-party data is untrusted too. Unlike AI output we do not require an exact match
        // (they may add fields), but everything we KEEP is checked, and extras are dropped.
        const parsed = schema.safeParse(json);
        return parsed.success
          ? ({ ok: true, data: parsed.data } as const)
          : ({ ok: false, reason: 'bad_response' } as const);
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network' } as const;
      }
    },
  };
}

import { SearchRequestSchema, SearchResponseSchema, type SearchResponse } from '@fixitfast/shared';

/**
 * Everything the UI can be told after a search. The page only ever sees one of these, so it
 * cannot forget to handle a failure, and it never touches raw network data.
 */
export type SearchOutcome =
  | { kind: 'results'; response: Extract<SearchResponse, { status: 'ok' }> }
  | { kind: 'degraded'; response: Extract<SearchResponse, { status: 'degraded' }> }
  | { kind: 'invalid_input' } // failed our own check; nothing was sent
  | { kind: 'rejected' } // the server said 400
  | { kind: 'unavailable' }; // network error, timeout, 429, 5xx, or a reply we do not trust

/** Same-origin by default: CloudFront will route /api/* to the API (step 9). No CORS needed. */
export const DEFAULT_API_BASE = '/api';

// Slightly above the Lambda's own 15 s limit, so the server gives up first and we show its answer.
const REQUEST_TIMEOUT_MS = 20_000;
// A real reply is a few KB. Refuse to read anything absurd.
const MAX_RESPONSE_CHARS = 200_000;

export interface SearchDeps {
  fetchImpl?: typeof fetch;
  apiBase?: string;
}

/** Never throws. Every failure becomes a SearchOutcome. */
export async function searchParts(rawQuery: string, deps: SearchDeps = {}): Promise<SearchOutcome> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const apiBase = deps.apiBase ?? DEFAULT_API_BASE;

  // Check 1: the same rules as the gateway and Lambda. Saves a round trip and gives instant feedback.
  const request = SearchRequestSchema.safeParse({ query: rawQuery });
  if (!request.success) return { kind: 'invalid_input' };

  let res: Response;
  try {
    res = await fetchImpl(`${apiBase}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request.data),
      credentials: 'omit', // we have no cookies; never send any
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { kind: 'unavailable' };
  }

  if (res.status === 400) return { kind: 'rejected' };
  if (!res.ok) return { kind: 'unavailable' };

  let parsed: unknown;
  try {
    const text = await res.text();
    if (text.length > MAX_RESPONSE_CHARS) return { kind: 'unavailable' };
    parsed = JSON.parse(text);
  } catch {
    return { kind: 'unavailable' };
  }

  // Check 2: never trust the reply's shape, even from our own API. This also re-applies the
  // trusted-link rule (https and ifixit.com only) to every url and imageUrl.
  const response = SearchResponseSchema.safeParse(parsed);
  if (!response.success) return { kind: 'unavailable' };

  return response.data.status === 'ok'
    ? { kind: 'results', response: response.data }
    : { kind: 'degraded', response: response.data };
}

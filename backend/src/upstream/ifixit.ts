import { z } from 'zod';
import { isTrustedLinkUrl, type ParsedEntities, type ResultItem } from '@fixitfast/shared';
import type { UpstreamClient, UpstreamFailure, UpstreamResult } from './http';

/** From iFixit's official OpenAPI spec (servers section). Read-only calls need no key. */
export const IFIXIT_API_BASE = 'https://www.ifixit.com/api/2.0';

export interface CatalogResults {
  guides: ResultItem[];
  parts: ResultItem[];
}

/** The handler only knows this interface, so tests can swap in a fake catalog. */
export interface Catalog {
  search(entities: ParsedEntities): Promise<UpstreamResult<CatalogResults>>;
}

const MAX_QUERY_LENGTH = 100;
const MAX_TITLE_LENGTH = 200;
const MAX_SUMMARY_LENGTH = 300;
const MAX_PER_LIST = 10;

export interface SearchPlan {
  /** Phrases to ask iFixit for parts ("items"), most specific first. */
  items: string[];
  /** Phrases to ask iFixit for repair guides. */
  guides: string[];
}

const phrase = (terms: (string | null)[]): string =>
  terms.filter((t): t is string => t !== null).join(' ').slice(0, MAX_QUERY_LENGTH).trim();

/**
 * Decides which phrases to send. Every piece already passed the character filter in the Zod
 * schema, and the client URL-encodes the phrase on top of that.
 *
 * Measured against the live API (backend/scripts/ifixit-probe.ts):
 *  - the full phrase "Samsung washer drive belt" finds the exact part but only one result;
 *  - the shorter "washer drive belt" returns up to 10 parts, across brands;
 *  - guides only match short phrases like "refrigerator ice maker" (none for longer ones).
 * So parts get two queries (specific, then broader) and guides get the short one.
 *
 * The model number is deliberately not used yet: part titles contain part numbers, not appliance
 * model numbers, and we have no evidence that it helps guides. Test it with the probe first.
 */
export function buildSearchPlan(entities: ParsedEntities): SearchPlan {
  const { brand, applianceType, part } = entities;
  const specific = phrase([brand, applianceType, part]);
  // Without a part, a bare appliance name would return arbitrary parts, so there is no broad query.
  const broad = part !== null ? phrase([applianceType, part]) : '';
  const guide = part !== null ? phrase([applianceType, part]) : phrase([brand, applianceType]);

  const unique = (list: string[]) => [...new Set(list.filter((p) => p !== ''))];
  return { items: unique([specific, broad]), guides: unique([guide]) };
}

// Step 1: only check that the wrapper is right. Each result is checked on its own below, so one
// odd item is dropped instead of failing the whole response.
const SuggestEnvelopeSchema = z.object({ results: z.array(z.unknown()) });

// Fields from the "GET /suggest/{query}" response in iFixit's API docs.
const SuggestItemSchema = z.object({
  dataType: z.string(),
  namespace: z.string().nullish(),
  title: z.string().min(1),
  summary: z.string().nullish(),
  url: z.string().refine(isTrustedLinkUrl),
  image: z.object({ thumbnail: z.unknown().optional() }).nullish(),
});

/**
 * What the live API returns (observed with the probe, not described in the docs):
 *  - guides come back as dataType "guide";
 *  - parts, requested with doctypes=item, come back as dataType "wiki" with namespace "ITEM".
 * Anything else is dropped on purpose: we only show shapes we have actually seen.
 */
export function toResultItem(raw: unknown): { kind: 'guide' | 'part'; item: ResultItem } | null {
  const parsed = SuggestItemSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { dataType, namespace, title, summary, url, image } = parsed.data;

  let kind: 'guide' | 'part';
  if (dataType === 'guide') kind = 'guide';
  else if (dataType === 'wiki' && namespace === 'ITEM') kind = 'part';
  else return null;

  const thumbnail = image?.thumbnail;
  return {
    kind,
    item: {
      // Plain text only. Nothing is stripped or interpreted here, so the frontend MUST render it as text.
      title: title.slice(0, MAX_TITLE_LENGTH),
      url,
      summary: summary ? summary.slice(0, MAX_SUMMARY_LENGTH) : null,
      imageUrl: typeof thumbnail === 'string' && isTrustedLinkUrl(thumbnail) ? thumbnail : null,
    },
  };
}

export function createIfixitCatalog(client: UpstreamClient): Catalog {
  const ask = (doctypes: 'guide' | 'item', query: string) =>
    client.getJson({ segments: ['suggest', query], query: { doctypes }, schema: SuggestEnvelopeSchema });

  return {
    async search(entities) {
      const plan = buildSearchPlan(entities);
      const calls = [...plan.items.map((q) => ask('item', q)), ...plan.guides.map((q) => ask('guide', q))];
      if (calls.length === 0) return { ok: true, data: { guides: [], parts: [] } };

      // All calls run at once, so the total wait is one call's timeout, not the sum.
      const responses = await Promise.all(calls);

      // If every call failed, report the first failure. If some worked, show what we have.
      const failures = responses.filter((r): r is { ok: false; reason: UpstreamFailure } => !r.ok);
      if (failures.length === responses.length) return failures[0]!;

      const guides = new Map<string, ResultItem>();
      const parts = new Map<string, ResultItem>();
      for (const response of responses) {
        if (!response.ok) continue;
        for (const raw of response.data.results) {
          const mapped = toResultItem(raw);
          if (!mapped) continue;
          // First one wins, and the most specific query was asked first, so it ranks first.
          const target = mapped.kind === 'guide' ? guides : parts;
          if (!target.has(mapped.item.url)) target.set(mapped.item.url, mapped.item);
        }
      }
      return {
        ok: true,
        data: { guides: [...guides.values()].slice(0, MAX_PER_LIST), parts: [...parts.values()].slice(0, MAX_PER_LIST) },
      };
    },
  };
}

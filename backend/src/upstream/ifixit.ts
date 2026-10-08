import { z } from 'zod';
import { isTrustedLinkUrl, type ParsedEntities, type ResultItem } from '@fixitfast/shared';
import type { UpstreamClient, UpstreamResult } from './http';

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

/**
 * Turns the validated entities into a search phrase. Every piece already passed the character
 * filter in the Zod schema, and the client URL-encodes the phrase on top of that.
 */
export function buildSearchQuery(entities: ParsedEntities): string {
  const terms = [entities.brand, entities.applianceType, entities.modelNumber, entities.part].filter(
    (t): t is string => t !== null,
  );
  return terms.join(' ').slice(0, MAX_QUERY_LENGTH).trim();
}

// Step 1: only check that the wrapper is right. Each result is checked on its own below, so one
// odd item is dropped instead of failing the whole response.
const SuggestEnvelopeSchema = z.object({ results: z.array(z.unknown()) });

// Fields from the "GET /suggest/{query}" response example in iFixit's API docs.
const SuggestItemSchema = z.object({
  dataType: z.string(),
  title: z.string().min(1),
  summary: z.string().nullish(),
  url: z.string().refine(isTrustedLinkUrl),
  image: z.object({ thumbnail: z.unknown().optional() }).nullish(),
});

export function toResultItem(raw: unknown): { kind: 'guide' | 'item'; item: ResultItem } | null {
  const parsed = SuggestItemSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { dataType, title, summary, url, image } = parsed.data;
  if (dataType !== 'guide' && dataType !== 'item') return null;

  const thumbnail = image?.thumbnail;
  return {
    kind: dataType,
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
  return {
    async search(entities) {
      const phrase = buildSearchQuery(entities);
      if (!phrase) return { ok: true, data: { guides: [], parts: [] } };

      const response = await client.getJson({
        segments: ['suggest', phrase],
        // "guide" and "item" are documented doctypes. What "item" returns is not described in the docs,
        // so it is mapped to `parts` as an assumption until a live call confirms it.
        query: { doctypes: 'guide,item' },
        schema: SuggestEnvelopeSchema,
      });
      if (!response.ok) return response;

      const guides: ResultItem[] = [];
      const parts: ResultItem[] = [];
      for (const raw of response.data.results) {
        const mapped = toResultItem(raw);
        if (!mapped) continue;
        (mapped.kind === 'guide' ? guides : parts).push(mapped.item);
      }
      return { ok: true, data: { guides: guides.slice(0, MAX_PER_LIST), parts: parts.slice(0, MAX_PER_LIST) } };
    },
  };
}

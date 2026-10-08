import { z } from 'zod';
import { ParsedEntitiesSchema } from './entities';

/**
 * Links that came from a third party are untrusted. A "javascript:" or look-alike URL in a
 * result would turn into an attack the moment the frontend renders it as a link. So the
 * backend filters with this, and the frontend re-checks with the same function before
 * rendering (defense in depth).
 */
export function isTrustedLinkUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'ifixit.com' || url.hostname.endsWith('.ifixit.com'));
  } catch {
    return false;
  }
}

export const ResultItemSchema = z.strictObject({
  title: z.string(),
  url: z.string().refine(isTrustedLinkUrl),
  summary: z.string().nullable(),
  imageUrl: z.string().refine(isTrustedLinkUrl).nullable(),
});
export type ResultItem = z.infer<typeof ResultItemSchema>;

export const DEGRADED_REASONS = ['parser_unavailable', 'invalid_ai_output', 'upstream_unavailable'] as const;
export type DegradedReason = (typeof DEGRADED_REASONS)[number];

/**
 * The contract between backend and frontend. Titles and summaries are PLAIN TEXT from a third
 * party: the frontend must render them as text, never as HTML.
 *
 * "degraded" means something failed but nothing crashed. `entities` is still filled in when we
 * understood the query and only the upstream search failed, so the page can say what it understood.
 */
export const SearchResponseSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('ok'),
    entities: ParsedEntitiesSchema,
    parts: z.array(ResultItemSchema),
    guides: z.array(ResultItemSchema),
  }),
  z.strictObject({
    status: z.literal('degraded'),
    reason: z.enum(DEGRADED_REASONS),
    entities: ParsedEntitiesSchema.nullable(),
    parts: z.array(ResultItemSchema).max(0),
    guides: z.array(ResultItemSchema).max(0),
  }),
]);
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

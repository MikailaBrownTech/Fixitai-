import { z } from 'zod';

/**
 * Rules for the raw search text a user types.
 *
 * The SAME constants will be used twice (defense in depth):
 *   1. API Gateway (step 6) rejects bad requests before Lambda ever runs.
 *   2. The Lambda re-checks with SearchRequestSchema, in case the gateway
 *      config is ever wrong or the Lambda is called some other way.
 */
export const QUERY_MAX_LENGTH = 100;

// Allowed: letters, digits, space, and . , ' / & -
// Everything else (quotes like ", braces, angle brackets, backticks, $, ;, \, newlines)
// is rejected. Those are the characters injection attempts rely on.
export const QUERY_PATTERN = /^[A-Za-z0-9 .,'/&-]+$/;

export const SearchRequestSchema = z.strictObject({
  query: z.string().trim().min(1).max(QUERY_MAX_LENGTH).regex(QUERY_PATTERN),
});

export type SearchRequest = z.infer<typeof SearchRequestSchema>;

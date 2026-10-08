import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SearchRequestSchema, validateEntitiesFromJson, type ParsedEntities } from '@fixitfast/shared';
import type { QueryParser } from './llm/types';

export type DegradedReason = 'parser_unavailable' | 'invalid_ai_output';

/**
 * What the frontend receives. `parts` and `guides` stay empty until step 5 adds the
 * upstream API. "degraded" means: we could not understand the query this time, but
 * nothing crashed, and the page can show a friendly fallback.
 */
export type SearchResponse =
  | { status: 'ok'; entities: ParsedEntities; parts: never[]; guides: never[] }
  | { status: 'degraded'; reason: DegradedReason; entities: null; parts: never[]; guides: never[] };

export interface HandlerDeps {
  parser: QueryParser;
  /** How long we wait for the LLM before giving up. */
  parserTimeoutMs?: number;
  /** Where structured log lines go. Defaults to console. Never receives user text. */
  log?: (line: Record<string, unknown>) => void;
}

// A valid body is tiny: {"query":"..."} with at most 100 characters of query.
const MAX_BODY_BYTES = 1024;
const DEFAULT_PARSER_TIMEOUT_MS = 8000;

const SECURITY_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
} as const;

function respond(statusCode: number, body: unknown): APIGatewayProxyResult {
  return { statusCode, headers: SECURITY_HEADERS, body: JSON.stringify(body) };
}

// Same message for every kind of bad input, so the API reveals nothing about which rule failed.
const badRequest = () => respond(400, { error: 'invalid_request' });

function degraded(reason: DegradedReason): APIGatewayProxyResult {
  const body: SearchResponse = { status: 'degraded', reason, entities: null, parts: [], guides: [] };
  return respond(200, body);
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export function createHandler(deps: HandlerDeps) {
  const timeoutMs = deps.parserTimeoutMs ?? DEFAULT_PARSER_TIMEOUT_MS;
  const log = deps.log ?? ((line) => console.log(JSON.stringify(line)));

  return async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    // 1. Guard the raw body before parsing anything.
    if (event.body == null || event.isBase64Encoded || Buffer.byteLength(event.body) > MAX_BODY_BYTES) {
      return badRequest();
    }

    let json: unknown;
    try {
      json = JSON.parse(event.body);
    } catch {
      return badRequest();
    }

    // 2. Re-check length and characters. API Gateway does this first (step 6), but the
    //    Lambda must not trust that it is configured correctly.
    const request = SearchRequestSchema.safeParse(json);
    if (!request.success) {
      return badRequest();
    }

    // 3. Ask the LLM to turn text into entities. Any failure here degrades, never crashes.
    let rawText: string;
    try {
      rawText = await withTimeout(
        Promise.resolve().then(() => deps.parser.parse(request.data.query)),
        timeoutMs,
      );
    } catch (err) {
      // Log the error TYPE only. Messages from upstream can contain request content.
      log({ event: 'parser_failed', kind: err instanceof Error ? err.name : 'unknown' });
      return degraded('parser_unavailable');
    }

    // 4. The model's output is untrusted. It matches the schema exactly or it is dropped.
    const validated = validateEntitiesFromJson(rawText);
    if (!validated.ok) {
      log({ event: 'ai_output_rejected', issues: validated.issues });
      return degraded('invalid_ai_output');
    }

    const body: SearchResponse = { status: 'ok', entities: validated.data, parts: [], guides: [] };
    return respond(200, body);
  };
}

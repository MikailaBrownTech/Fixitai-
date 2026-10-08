import { ParsedEntitiesSchema, type ParsedEntities } from './entities';

/**
 * A validation outcome as plain data, so callers branch on `ok` instead of
 * catching exceptions. A failure lists WHERE and WHY (path + code) but never
 * includes the offending value. That keeps attacker-controlled text out of
 * logs and error responses.
 */
export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; issues: { path: string; code: string }[] };

export function validateEntities(raw: unknown): ValidationResult<ParsedEntities> {
  const result = ParsedEntitiesSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      code: issue.code,
    })),
  };
}

/**
 * Same check for raw model text. The text must be JSON and nothing else:
 * no markdown fences, no "Sure! Here is the JSON:" preamble.
 */
export function validateEntitiesFromJson(text: string): ValidationResult<ParsedEntities> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, issues: [{ path: '', code: 'invalid_json' }] };
  }
  return validateEntities(parsed);
}

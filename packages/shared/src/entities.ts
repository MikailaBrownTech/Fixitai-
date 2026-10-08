import { z } from 'zod';

export const APPLIANCE_TYPES = [
  'dryer',
  'washer',
  'refrigerator',
  'freezer',
  'dishwasher',
  'oven',
  'range',
  'microwave',
] as const;

/**
 * The ONLY shape we accept from the LLM.
 *
 * Why each choice:
 * - strictObject: any extra field means the whole output is rejected.
 * - nullable (not optional): all four keys must be present. The model must say
 *   "null" when it can't find something, so a missing key is a failure, not a guess.
 * - enum for applianceType: the model can't invent a category.
 * - regex + max length + word cap on text fields: no quotes, braces, semicolons
 *   or sentence-length text can pass through to later steps (the upstream API call).
 *   KNOWN LIMIT: a short plain-English phrase that fits these rules (for example
 *   "ignore instructions") still passes. Format checks can't judge meaning, so later
 *   layers must treat these strings as plain data (parameterized upstream calls,
 *   never fed to another LLM, never executed).
 * - No trim/transform anywhere: we never "fix" AI output. It matches exactly or it's dropped.
 */
const wordCount = (s: string) => s.split(' ').filter(Boolean).length;

/**
 * Scope rule: a search must be anchored to an appliance type, a brand or a model number. A part
 * name alone ("drive belt", "dog leash") is rejected, because it could be about anything. A model
 * number only counts as an anchor if it contains a digit (real ones always do: WED4815EW,
 * DC66-10170B), so a model-number field filled with plain words does not slip through.
 * KNOWN LIMIT: a brand alone is a weak anchor (for example "Apple laptop battery" passes).
 */
function hasAnchor(e: { applianceType: string | null; brand: string | null; modelNumber: string | null }): boolean {
  return e.applianceType !== null || e.brand !== null || (e.modelNumber !== null && /\d/.test(e.modelNumber));
}

export const ParsedEntitiesSchema = z
  .strictObject({
    applianceType: z.enum(APPLIANCE_TYPES).nullable(),
    brand: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[A-Za-z0-9][A-Za-z0-9 &'.-]*$/)
      .refine((s) => wordCount(s) <= 4, { message: 'too many words' })
      .nullable(),
    modelNumber: z
      .string()
      .min(3)
      .max(30)
      .regex(/^[A-Za-z0-9-]+$/)
      .nullable(),
    part: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[A-Za-z0-9][A-Za-z0-9 /'.-]*$/)
      .refine((s) => wordCount(s) <= 5, { message: 'too many words' })
      .nullable(),
  })
  .refine(hasAnchor, { message: 'no appliance, brand or model number found' });

export type ParsedEntities = z.infer<typeof ParsedEntitiesSchema>;

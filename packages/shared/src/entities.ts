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
  .refine((e) => Object.values(e).some((v) => v !== null), {
    message: 'no entities extracted',
  });

export type ParsedEntities = z.infer<typeof ParsedEntitiesSchema>;

import type { QueryParser } from './types';

// Display names the real schema will accept, keyed by the lowercase phrase we look for.
const BRANDS: Record<string, string> = {
  whirlpool: 'Whirlpool',
  'general electric': 'General Electric',
  ge: 'GE',
  samsung: 'Samsung',
  lg: 'LG',
  frigidaire: 'Frigidaire',
  maytag: 'Maytag',
  kenmore: 'Kenmore',
  bosch: 'Bosch',
  kitchenaid: 'KitchenAid',
};

const APPLIANCES: Record<string, string> = {
  dryer: 'dryer',
  washer: 'washer',
  'washing machine': 'washer',
  refrigerator: 'refrigerator',
  fridge: 'refrigerator',
  freezer: 'freezer',
  dishwasher: 'dishwasher',
  oven: 'oven',
  range: 'range',
  stove: 'range',
  microwave: 'microwave',
};

// Letters, then digits, then optional letters, like WED4815EW or GTW460ASJ.
const MODEL_PATTERN = /\b[A-Za-z]{2,4}\d{3,5}[A-Za-z]{0,3}\b/;

const FILLER = new Set(['for', 'a', 'an', 'the', 'my', 'need', 'new', 'replacement', 'part', 'parts']);

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wholePhrase = (phrase: string) => new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'i');

function findKey(text: string, table: Record<string, string>): { key: string; value: string } | null {
  // Longest phrases first so "washing machine" wins over any shorter overlap.
  for (const key of Object.keys(table).sort((a, b) => b.length - a.length)) {
    if (wholePhrase(key).test(text)) return { key, value: table[key] as string };
  }
  return null;
}

/**
 * A deterministic stand-in for the LLM: simple keyword rules, no network, no cost.
 * It returns JSON TEXT, exactly like a real model would, so the handler's validation
 * path is exercised the same way. It is deliberately dumb. It exists so we can build
 * and test everything else before any paid model is involved.
 */
export function createMockParser(): QueryParser {
  return {
    async parse(query: string): Promise<string> {
      let rest = query;

      const brand = findKey(rest, BRANDS);
      if (brand) rest = rest.replace(wholePhrase(brand.key), ' ');

      const appliance = findKey(rest, APPLIANCES);
      if (appliance) rest = rest.replace(wholePhrase(appliance.key), ' ');

      const model = rest.match(MODEL_PATTERN)?.[0] ?? null;
      if (model) rest = rest.replace(model, ' ');

      const words = rest
        .split(/[^A-Za-z0-9/'.-]+/)
        .filter((w) => w && !FILLER.has(w.toLowerCase()));
      const part = words.length > 0 ? words.join(' ') : null;

      return JSON.stringify({
        applianceType: appliance?.value ?? null,
        brand: brand?.value ?? null,
        modelNumber: model ? model.toUpperCase() : null,
        part,
      });
    },
  };
}

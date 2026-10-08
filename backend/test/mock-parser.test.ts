import { describe, expect, it } from 'vitest';
import { validateEntitiesFromJson } from '@fixitfast/shared';
import { createMockParser } from '../src/llm/mock';

const parser = createMockParser();

describe('mock parser', () => {
  it('extracts all four entities from the headline example', async () => {
    const raw = await parser.parse('heating element for whirlpool dryer WED4815EW');
    expect(JSON.parse(raw)).toEqual({
      applianceType: 'dryer',
      brand: 'Whirlpool',
      modelNumber: 'WED4815EW',
      part: 'heating element',
    });
  });

  it('returns nulls for what it cannot find', async () => {
    const raw = await parser.parse('dryer belt');
    expect(JSON.parse(raw)).toEqual({
      applianceType: 'dryer',
      brand: null,
      modelNumber: null,
      part: 'belt',
    });
  });

  it('maps synonyms to the allowed appliance list', async () => {
    const raw = await parser.parse('fridge water filter');
    expect(JSON.parse(raw).applianceType).toBe('refrigerator');
  });

  it('returns TEXT that passes the real schema, like a well-behaved model', async () => {
    const raw = await parser.parse('door gasket for samsung washer');
    expect(typeof raw).toBe('string');
    expect(validateEntitiesFromJson(raw).ok).toBe(true);
  });

  it('returns all nulls for gibberish (the handler then degrades)', async () => {
    const raw = await parser.parse('qqq');
    expect(JSON.parse(raw)).toEqual({ applianceType: null, brand: null, modelNumber: null, part: 'qqq' });
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { SearchResponseSchema, type ResultItem } from '@fixitfast/shared';
import { createHandler } from '../src/handler';
import type { QueryParser } from '../src/llm/types';
import type { Catalog } from '../src/upstream/ifixit';
import type { UpstreamFailure } from '../src/upstream/http';
import { failingCatalog } from './helpers';

const event = (query: string) =>
  ({ body: JSON.stringify({ query }), isBase64Encoded: false }) as unknown as APIGatewayProxyEvent;

const goodAi = JSON.stringify({
  applianceType: 'dryer',
  brand: 'Whirlpool',
  modelNumber: 'WED4815EW',
  part: 'heating element',
});
const goodParser: QueryParser = { parse: async () => goodAi };
const silent = () => {};

const guide: ResultItem = {
  title: 'Whirlpool Dryer Heating Element Replacement',
  url: 'https://www.ifixit.com/Guide/Whirlpool+Dryer+Heating+Element/1',
  summary: 'Replace a broken heating element.',
  imageUrl: null,
};

describe('upstream search results', () => {
  it('returns guides and parts from the catalog, in a response that matches the shared contract', async () => {
    const catalog: Catalog = { search: async () => ({ ok: true, data: { guides: [guide], parts: [] } }) };
    const res = await createHandler({ parser: goodParser, catalog, log: silent })(event('heating element for whirlpool dryer'));
    expect(res.statusCode).toBe(200);
    const body = SearchResponseSchema.parse(JSON.parse(res.body));
    expect(body).toMatchObject({ status: 'ok', guides: [guide], parts: [] });
  });

  it('gives the catalog the VALIDATED entities, not raw model text', async () => {
    const search = vi.fn<Catalog['search']>(async () => ({ ok: true, data: { guides: [], parts: [] } }));
    await createHandler({ parser: goodParser, catalog: { search }, log: silent })(event('dryer belt'));
    expect(search).toHaveBeenCalledWith({
      applianceType: 'dryer',
      brand: 'Whirlpool',
      modelNumber: 'WED4815EW',
      part: 'heating element',
    });
  });
});

// Security requirement 4: iFixit being down must not crash the app or lose what we understood.
describe('upstream failures degrade gracefully', () => {
  it.each<UpstreamFailure>(['timeout', 'rate_limited', 'upstream_error', 'bad_response', 'too_large', 'network', 'not_found'])(
    'iFixit failure "%s" -> 200 degraded, entities kept, no results',
    async (reason) => {
      const logged: Record<string, unknown>[] = [];
      const handler = createHandler({ parser: goodParser, catalog: failingCatalog(reason), log: (l) => logged.push(l) });
      const res = await handler(event('dryer belt'));

      expect(res.statusCode).toBe(200);
      const body = SearchResponseSchema.parse(JSON.parse(res.body));
      expect(body).toMatchObject({
        status: 'degraded',
        reason: 'upstream_unavailable',
        entities: { brand: 'Whirlpool' },
        parts: [],
        guides: [],
      });
      expect(logged).toEqual([{ event: 'upstream_failed', reason }]);
    },
  );

  it('a catalog that throws (a bug) still degrades and leaks nothing', async () => {
    const catalog: Catalog = {
      search: async () => {
        throw new Error('exploded at https://www.ifixit.com/?token=SECRET-TOKEN');
      },
    };
    const logged: Record<string, unknown>[] = [];
    const res = await createHandler({ parser: goodParser, catalog, log: (l) => logged.push(l) })(event('dryer belt'));
    expect(JSON.parse(res.body)).toMatchObject({ status: 'degraded', reason: 'upstream_unavailable' });
    expect(res.body).not.toContain('SECRET-TOKEN');
    expect(JSON.stringify(logged)).not.toContain('SECRET-TOKEN');
  });
});

describe('nothing reaches iFixit unless every earlier check passed', () => {
  const never = () => {
    const search = vi.fn<Catalog['search']>(async () => ({ ok: true, data: { guides: [], parts: [] } }));
    return { search, catalog: { search } as Catalog };
  };

  it('bad input -> catalog not called', async () => {
    const { search, catalog } = never();
    const res = await createHandler({ parser: goodParser, catalog, log: silent })(event('a'.repeat(101)));
    expect(res.statusCode).toBe(400);
    expect(search).not.toHaveBeenCalled();
  });

  it('invalid AI output -> catalog not called', async () => {
    const { search, catalog } = never();
    const parser: QueryParser = { parse: async () => JSON.stringify({ applianceType: 'dryer', evil: true }) };
    const res = await createHandler({ parser, catalog, log: silent })(event('dryer belt'));
    expect(JSON.parse(res.body)).toMatchObject({ reason: 'invalid_ai_output' });
    expect(search).not.toHaveBeenCalled();
  });

  it('parser failure -> catalog not called', async () => {
    const { search, catalog } = never();
    const parser: QueryParser = {
      parse: async () => {
        throw new Error('down');
      },
    };
    await createHandler({ parser, catalog, log: silent })(event('dryer belt'));
    expect(search).not.toHaveBeenCalled();
  });
});

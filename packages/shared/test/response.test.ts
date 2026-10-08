import { describe, expect, it } from 'vitest';
import { SearchResponseSchema, isTrustedLinkUrl } from '../src/index';

const entities = { applianceType: 'dryer', brand: 'Whirlpool', modelNumber: 'WED4815EW', part: 'heating element' };
const item = { title: 'Dryer Heating Element Replacement', url: 'https://www.ifixit.com/Guide/x/1', summary: null, imageUrl: null };

describe('isTrustedLinkUrl', () => {
  it.each([
    ['https://www.ifixit.com/Guide/x/1', true],
    ['https://ifixit.com/Guide/x/1', true],
    ['https://guide-images.cdn.ifixit.com/igi/abc.mini', true],
    ['javascript:alert(1)', false],
    ['http://www.ifixit.com/Guide/x/1', false],
    ['https://ifixit.com.evil.test/x', false],
    ['https://evil.test/ifixit.com', false],
    ['https://notifixit.com/x', false],
    ['data:text/html,<script>1</script>', false],
    ['//www.ifixit.com/x', false],
    ['not a url', false],
    ['', false],
  ])('%s -> %s', (value, expected) => {
    expect(isTrustedLinkUrl(value)).toBe(expected);
  });
});

describe('SearchResponseSchema', () => {
  it('accepts an ok response with results', () => {
    expect(SearchResponseSchema.safeParse({ status: 'ok', entities, parts: [item], guides: [item] }).success).toBe(true);
  });

  it('accepts a degraded response that still carries the understood entities', () => {
    const r = SearchResponseSchema.safeParse({ status: 'degraded', reason: 'upstream_unavailable', entities, parts: [], guides: [] });
    expect(r.success).toBe(true);
  });

  it('accepts a degraded response with no entities', () => {
    const r = SearchResponseSchema.safeParse({ status: 'degraded', reason: 'parser_unavailable', entities: null, parts: [], guides: [] });
    expect(r.success).toBe(true);
  });

  it('rejects a degraded response that contains results', () => {
    const r = SearchResponseSchema.safeParse({ status: 'degraded', reason: 'upstream_unavailable', entities, parts: [item], guides: [] });
    expect(r.success).toBe(false);
  });

  it('rejects extra fields, unknown reasons and unknown statuses', () => {
    expect(SearchResponseSchema.safeParse({ status: 'ok', entities, parts: [], guides: [], debug: 1 }).success).toBe(false);
    expect(SearchResponseSchema.safeParse({ status: 'degraded', reason: 'because', entities: null, parts: [], guides: [] }).success).toBe(false);
    expect(SearchResponseSchema.safeParse({ status: 'weird' }).success).toBe(false);
  });

  it('rejects a result whose link or image is not a trusted https iFixit URL', () => {
    const bad = { ...item, url: 'javascript:alert(1)' };
    expect(SearchResponseSchema.safeParse({ status: 'ok', entities, parts: [], guides: [bad] }).success).toBe(false);
    const badImage = { ...item, imageUrl: 'https://evil.test/x.png' };
    expect(SearchResponseSchema.safeParse({ status: 'ok', entities, parts: [], guides: [badImage] }).success).toBe(false);
  });
});

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Results } from '../components/Results';
import type { SearchOutcome } from '../lib/search';

const entities = { applianceType: 'dryer', brand: null, modelNumber: null, part: 'belt' } as const;
const html = (outcome: SearchOutcome) => renderToStaticMarkup(createElement(Results, { outcome }));

const hostile = {
  title: '<img src=x onerror=alert(1)>Belt',
  url: 'https://www.ifixit.com/Device/Dryer',
  summary: '<script>alert("xss")</script>',
  imageUrl: null,
};

describe('third-party text is rendered as text, never as HTML', () => {
  const out = html({ kind: 'results', response: { status: 'ok', entities, parts: [hostile], guides: [] } });

  it('escapes markup in titles and summaries', () => {
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;Belt');
  });

  it('opens links safely', () => {
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('href="https://www.ifixit.com/Device/Dryer"');
  });
});

describe('links are re-checked at render time', () => {
  it('drops an untrusted link even if one slipped past validation', () => {
    const bad = { ...hostile, title: 'Evil', url: 'javascript:alert(1)' };
    const out = html({ kind: 'results', response: { status: 'ok', entities, parts: [bad], guides: [] } });
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('Evil');
  });
});

describe('every outcome has a message', () => {
  it.each<[string, SearchOutcome, string]>([
    ['invalid_input', { kind: 'invalid_input' }, '1–100 characters'],
    ['rejected', { kind: 'rejected' }, 'not accepted'],
    ['unavailable', { kind: 'unavailable' }, 'unavailable right now'],
    ['degraded', { kind: 'degraded', response: { status: 'degraded', reason: 'upstream_unavailable', entities, parts: [], guides: [] } }, 'repair-guide source'],
    ['degraded: not an appliance search', { kind: 'degraded', response: { status: 'degraded', reason: 'invalid_ai_output', entities: null, parts: [], guides: [] } }, 'match that to an appliance'],
    ['empty results', { kind: 'results', response: { status: 'ok', entities, parts: [], guides: [] } }, 'No matches'],
  ])('%s', (_label, outcome, text) => {
    expect(html(outcome)).toContain(text);
  });
});

describe('source guard', () => {
  it('never uses dangerouslySetInnerHTML or innerHTML in the web code', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    for (const dir of ['app', 'components', 'lib']) {
      for (const file of readdirSync(`${root}/${dir}`)) {
        const src = readFileSync(`${root}/${dir}/${file}`, 'utf8');
        expect(src, `${dir}/${file}`).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML|eval\(/);
      }
    }
  });
});

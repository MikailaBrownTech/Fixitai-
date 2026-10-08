/**
 * Opt-in diagnostic: asks iFixit's public suggest endpoint a few differently-worded versions of
 * a search and shows what comes back, so we can design the query and the filter from facts.
 *
 * Costs: 12 small GET requests to iFixit (no key, no money). iFixit's rate limits are not
 * published, so it waits between calls. Run: npm run probe:ifixit -w @fixitfast/backend
 */
import { z } from 'zod';
import { isTrustedLinkUrl } from '@fixitfast/shared';
import { createUpstreamClient } from '../src/upstream/http';
import { IFIXIT_API_BASE } from '../src/upstream/ifixit';

const CASES = [
  { brand: 'Samsung', appliance: 'washer', part: 'drive belt' },
  { brand: 'LG', appliance: 'dishwasher', part: 'door gasket' },
  { brand: 'Kenmore', appliance: 'refrigerator', part: 'ice maker' },
];

const variants = (c: (typeof CASES)[number]) => [
  { label: 'what the app sends', doctypes: 'guide,item', phrase: `${c.brand} ${c.appliance} ${c.part}` },
  { label: 'item only: appliance+part', doctypes: 'item', phrase: `${c.appliance} ${c.part}` },
  { label: 'item only: brand+appliance', doctypes: 'item', phrase: `${c.brand} ${c.appliance}` },
  { label: 'guide only: appliance+part', doctypes: 'guide', phrase: `${c.appliance} ${c.part}` },
];

// iFixit text is untrusted, so show only plain printable characters in the terminal.
const printable = (v: unknown, max = 60) => String(v ?? '').replace(/[^\x20-\x7E]/g, '?').slice(0, max);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const Envelope = z.object({ results: z.array(z.record(z.string(), z.unknown())) });
const client = createUpstreamClient({ baseUrl: IFIXIT_API_BASE });

for (const c of CASES) {
  console.log(`\n=== ${c.brand} ${c.appliance} ${c.part} ===`);
  for (const v of variants(c)) {
    const res = await client.getJson({ segments: ['suggest', v.phrase], query: { doctypes: v.doctypes }, schema: Envelope });
    if (!res.ok) {
      console.log(`  [${v.doctypes}] "${v.phrase}"  FAILED: ${res.reason}`);
    } else {
      const raw = res.data.results;
      const byType: Record<string, number> = {};
      for (const r of raw) byType[printable(r.dataType, 20)] = (byType[printable(r.dataType, 20)] ?? 0) + 1;
      const trusted = raw.filter((r) => typeof r.url === 'string' && isTrustedLinkUrl(r.url)).length;
      console.log(`  [${v.doctypes}] "${v.phrase}"  raw=${raw.length} ${JSON.stringify(byType)} trusted-url=${trusted}`);
      for (const r of raw.slice(0, 4)) {
        const path = typeof r.url === 'string' ? printable(r.url.replace(/^https?:\/\/[^/]+/, ''), 50) : '-';
        console.log(`      ${printable(r.dataType, 8).padEnd(6)} ns=${printable(r.namespace, 10).padEnd(10)} ${printable(r.title)}  ->  ${path}`);
      }
    }
    await sleep(600);
  }
}

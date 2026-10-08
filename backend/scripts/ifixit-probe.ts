/**
 * Opt-in diagnostic: asks iFixit's public suggest endpoint a few differently-worded versions of
 * a search and shows, for each, how many raw results came back and how many survive our own
 * validation. It answers "is iFixit empty, is our query shape wrong, or is our filter too strict?"
 *
 * Costs: about 12 small GET requests to iFixit (no key, no money). iFixit's rate limits are not
 * published, so it waits between calls. Run: npm run probe:ifixit -w @fixitfast/backend
 */
import { z } from 'zod';
import { createUpstreamClient } from '../src/upstream/http';
import { IFIXIT_API_BASE, toResultItem } from '../src/upstream/ifixit';

const CASES = [
  { brand: 'Samsung', appliance: 'washer', part: 'drive belt' },
  { brand: 'LG', appliance: 'dishwasher', part: 'door gasket' },
  { brand: 'Kenmore', appliance: 'refrigerator', part: 'ice maker' }, // worked in the app
];

const variants = (c: (typeof CASES)[number]) => [
  { label: 'full (what the app sends)', phrase: `${c.brand} ${c.appliance} ${c.part}` },
  { label: 'without brand', phrase: `${c.appliance} ${c.part}` },
  { label: 'brand + appliance only', phrase: `${c.brand} ${c.appliance}` },
  { label: 'part only', phrase: c.part },
];

// iFixit text is untrusted, so show only plain printable characters in the terminal.
const printable = (s: string) => s.replace(/[^\x20-\x7E]/g, '?').slice(0, 70);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const Envelope = z.object({ results: z.array(z.unknown()) });
const client = createUpstreamClient({ baseUrl: IFIXIT_API_BASE });

for (const c of CASES) {
  console.log(`\n=== ${c.brand} ${c.appliance} ${c.part} ===`);
  for (const v of variants(c)) {
    const res = await client.getJson({ segments: ['suggest', v.phrase], query: { doctypes: 'guide,item' }, schema: Envelope });
    if (!res.ok) {
      console.log(`  ${v.label.padEnd(28)} FAILED: ${res.reason}`);
    } else {
      const raw = res.data.results;
      const byType: Record<string, number> = {};
      for (const r of raw) {
        const t = typeof r === 'object' && r !== null && 'dataType' in r ? String((r as { dataType: unknown }).dataType) : '?';
        byType[printable(t)] = (byType[printable(t)] ?? 0) + 1;
      }
      const kept = raw.map(toResultItem).filter((x) => x !== null);
      console.log(`  ${v.label.padEnd(28)} raw=${raw.length} ${JSON.stringify(byType)} kept=${kept.length}`);
      for (const k of kept.slice(0, 2)) console.log(`      ${k.kind}: ${printable(k.item.title)}`);
      if (raw.length > kept.length) console.log(`      (${raw.length - kept.length} raw result(s) were dropped by our validation)`);
    }
    await sleep(600);
  }
}

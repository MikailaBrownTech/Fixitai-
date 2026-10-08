'use client';

import { useState, type FormEvent } from 'react';
import { QUERY_MAX_LENGTH } from '@fixitfast/shared';
import { Results } from '../components/Results';
import { Skeleton } from '../components/Skeleton';
import { searchParts, type SearchOutcome } from '../lib/search';

// Each one passes the same checks as anything a visitor types.
const EXAMPLES = [
  'heating element for whirlpool dryer WED4815EW',
  'ice maker for kenmore refrigerator',
  "samsung washer won't spin, need a new belt",
];

export default function Home() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);

  async function run(text: string) {
    if (loading) return; // one request at a time
    setLoading(true);
    setOutcome(await searchParts(text)); // never throws
    setLoading(false);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void run(query);
  }

  function pickExample(text: string) {
    setQuery(text);
    void run(text);
  }

  return (
    <div className="shell">
      <header className="top">
        <span className="wordmark">FixItFast</span>
        <span className="tagline">Appliance parts and repair guides</span>
      </header>

      <main>
        <section className="hero">
          <h1>Find the right appliance part</h1>
          <p className="lead">Say what you need in your own words. Include the appliance, brand or model number if you know it.</p>

          <form className="search" onSubmit={onSubmit}>
            <label htmlFor="q" className="sr-only">
              What do you need?
            </label>
            <input
              id="q"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={QUERY_MAX_LENGTH}
              autoComplete="off"
              spellCheck={false}
              placeholder="heating element for whirlpool dryer WED4815EW"
            />
            <button type="submit" disabled={loading}>
              {loading ? 'Searching' : 'Search'}
            </button>
          </form>

          <div className="examples">
            <span>Try</span>
            {EXAMPLES.map((text) => (
              <button type="button" key={text} className="chip" onClick={() => pickExample(text)} disabled={loading}>
                {text}
              </button>
            ))}
          </div>
        </section>

        <div className="output" aria-busy={loading}>
          {loading ? (
            <>
              <p className="sr-only" role="status">
                Searching
              </p>
              <Skeleton />
            </>
          ) : outcome ? (
            <Results outcome={outcome} />
          ) : null}
        </div>
      </main>

      <footer className="foot">
        <p>
          Results and guides come from{' '}
          <a href="https://www.ifixit.com" target="_blank" rel="noopener noreferrer">
            iFixit
          </a>
          . FixItFast is an independent portfolio project, not affiliated with iFixit.
        </p>
      </footer>
    </div>
  );
}

'use client';

import { useState, type FormEvent } from 'react';
import { QUERY_MAX_LENGTH } from '@fixitfast/shared';
import { Results } from '../components/Results';
import { searchParts, type SearchOutcome } from '../lib/search';

export default function Home() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (loading) return; // one request at a time
    setLoading(true);
    setOutcome(await searchParts(query)); // never throws
    setLoading(false);
  }

  return (
    <main>
      <h1>FixItFast</h1>
      <p className="lead">Describe the part you need, for example “heating element for whirlpool dryer WED4815EW”.</p>
      <form onSubmit={onSubmit}>
        <label htmlFor="q">What do you need?</label>
        <input
          id="q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={QUERY_MAX_LENGTH}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>
      {outcome ? <Results outcome={outcome} /> : null}
      <footer>
        Results and guides come from <a href="https://www.ifixit.com" target="_blank" rel="noopener noreferrer">iFixit</a>.
        FixItFast is an independent portfolio project, not affiliated with iFixit.
      </footer>
    </main>
  );
}

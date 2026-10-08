import { isTrustedLinkUrl, type ResultItem } from '@fixitfast/shared';
import type { SearchOutcome } from '../lib/search';

/**
 * SECURITY: every string below comes from a third party (iFixit) or from the AI. React escapes
 * anything placed inside {curly braces}, so it shows as plain text and can never run as HTML.
 * We never use React's raw-HTML escape hatch (a test checks this).
 */

const DEGRADED_MESSAGES = {
  parser_unavailable: 'Our search helper is unavailable right now. Please try again in a moment.',
  invalid_ai_output: "We couldn't match that to an appliance. Try including the appliance type, brand or model number, plus the part.",
  upstream_unavailable: 'The repair-guide source is unavailable right now. Please try again in a moment.',
} as const;

function ItemList({ heading, items }: { heading: string; items: ResultItem[] }) {
  // Re-check every link even though the data was already validated: cheap, and it keeps this
  // component safe on its own.
  const safe = items.filter((i) => isTrustedLinkUrl(i.url));
  if (safe.length === 0) return null;
  return (
    <section>
      <h2>{heading}</h2>
      <ul className="items">
        {safe.map((item) => (
          <li key={item.url}>
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              {item.title}
            </a>
            {item.summary ? <p>{item.summary}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Results({ outcome }: { outcome: SearchOutcome }) {
  switch (outcome.kind) {
    case 'invalid_input':
      return (
        <p role="alert" className="notice">
          Use 1–100 characters: letters, numbers, spaces and . , ' / &amp; - only.
        </p>
      );
    case 'rejected':
      return (
        <p role="alert" className="notice">
          That search was not accepted. Please check it and try again.
        </p>
      );
    case 'unavailable':
      return (
        <p role="alert" className="notice">
          Search is unavailable right now. Please try again in a moment.
        </p>
      );
    case 'degraded':
      return (
        <p role="status" className="notice">
          {DEGRADED_MESSAGES[outcome.response.reason]}
        </p>
      );
    case 'results': {
      const { parts, guides } = outcome.response;
      if (parts.length === 0 && guides.length === 0) {
        return (
          <p role="status" className="notice">
            No matches found. Try a different part name or model number.
          </p>
        );
      }
      return (
        <div role="status">
          <ItemList heading="Parts" items={parts} />
          <ItemList heading="Repair guides" items={guides} />
        </div>
      );
    }
  }
}

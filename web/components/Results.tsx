import { isTrustedLinkUrl, type ParsedEntities, type ResultItem } from '@fixitfast/shared';
import { splitPartNumber } from '../lib/format';
import type { SearchOutcome } from '../lib/search';
import { PartTag } from './PartTag';

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

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function ExternalIcon() {
  return (
    <svg className="ext" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M6.5 3.5H4A1.5 1.5 0 0 0 2.5 5v7A1.5 1.5 0 0 0 4 13.5h7a1.5 1.5 0 0 0 1.5-1.5V9.5M9 2.5h4.5V7M13.25 2.75 7.5 8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** What the AI took from the sentence. Only the fields it found are shown. */
function Understood({ entities }: { entities: ParsedEntities }) {
  const fields: [string, string][] = [];
  if (entities.applianceType) fields.push(['Appliance', capitalize(entities.applianceType)]);
  if (entities.brand) fields.push(['Brand', entities.brand]);
  if (entities.modelNumber) fields.push(['Model', entities.modelNumber]);
  if (entities.part) fields.push(['Part', capitalize(entities.part)]);
  if (fields.length === 0) return null;

  return (
    <section className="understood" aria-label="What we understood">
      <p className="understood-title">What we understood</p>
      <dl>
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ItemList({ heading, items, emptyText, showPartNumbers }: { heading: string; items: ResultItem[]; emptyText: string; showPartNumbers: boolean }) {
  return (
    <section className="group">
      <h2>
        {heading} <span className="count">{items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p className="empty">{emptyText}</p>
      ) : (
        <ul className="items">
          {items.map((item) => {
            const { name, partNumber } = showPartNumbers ? splitPartNumber(item.title) : { name: item.title, partNumber: null };
            return (
              <li key={item.url} className="item">
                <a className="item-link" href={item.url} target="_blank" rel="noopener noreferrer">
                  <span className="item-name">
                    {name}
                    <ExternalIcon />
                    <span className="sr-only"> (opens on iFixit in a new tab)</span>
                  </span>
                  {item.summary ? <span className="item-summary">{item.summary}</span> : null}
                </a>
                {partNumber ? <PartTag number={partNumber} /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const trusted = (items: ResultItem[]) => items.filter((i) => isTrustedLinkUrl(i.url));

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
        <div>
          {outcome.response.entities ? <Understood entities={outcome.response.entities} /> : null}
          <p role="status" className="notice">
            {DEGRADED_MESSAGES[outcome.response.reason]}
          </p>
        </div>
      );
    case 'results': {
      // Re-check every link even though the data was already validated: cheap, and it keeps this
      // component safe on its own.
      const parts = trusted(outcome.response.parts);
      const guides = trusted(outcome.response.guides);
      if (parts.length === 0 && guides.length === 0) {
        return (
          <div>
            <Understood entities={outcome.response.entities} />
            <p role="status" className="notice">
              No matches found. Try a different part name or model number.
            </p>
          </div>
        );
      }
      return (
        <div role="status">
          <Understood entities={outcome.response.entities} />
          <ItemList heading="Parts" items={parts} emptyText="No parts found for this search." showPartNumbers />
          <ItemList heading="Repair guides" items={guides} emptyText="No repair guides found for this search." showPartNumbers={false} />
        </div>
      );
    }
  }
}

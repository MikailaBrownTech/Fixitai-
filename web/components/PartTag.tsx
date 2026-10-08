'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A part number shown as a small tag. Clicking it copies the number, because that is what people
 * do with it next (paste it into a retailer's search). The number is rendered as plain text.
 */
export function PartTag({ number }: { number: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(number);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be refused (older browsers, permissions). The number is still on screen.
    }
  }

  return (
    <button
      type="button"
      className={copied ? 'tag tag-copied' : 'tag'}
      onClick={copy}
      aria-label={`Copy part number ${number}`}
    >
      <span>{number}</span>
      <span className="tag-state" role="status">
        {copied ? 'Copied' : ''}
      </span>
    </button>
  );
}

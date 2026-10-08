import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
// Self-hosted: the font files are bundled into the site, so no request to any other domain
// (the Content Security Policy would block one).
import '@fontsource-variable/atkinson-hyperlegible-next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FixItFast',
  description: 'Describe an appliance problem in plain English and find parts and repair guides.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

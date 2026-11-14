import localFont from 'next/font/local';
import { loadWebProductConfig } from '../lib/product-config';

import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';
import './globals.css';

// Shared typography for the remote surface.
const ibmPlexSans = localFont({
  src: [
    {
      path: '../fonts/ibm-plex-sans/ibm-plex-sans-latin-400-normal.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../fonts/ibm-plex-sans/ibm-plex-sans-latin-500-normal.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../fonts/ibm-plex-sans/ibm-plex-sans-latin-600-normal.woff2',
      weight: '600',
      style: 'normal',
    },
    {
      path: '../fonts/ibm-plex-sans/ibm-plex-sans-latin-700-normal.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-sans',
  display: 'swap',
});

const ibmPlexMono = localFont({
  src: [
    {
      path: '../fonts/ibm-plex-mono/ibm-plex-mono-latin-400-normal.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../fonts/ibm-plex-mono/ibm-plex-mono-latin-500-normal.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../fonts/ibm-plex-mono/ibm-plex-mono-latin-600-normal.woff2',
      weight: '600',
      style: 'normal',
    },
  ],
  variable: '--font-mono',
  display: 'swap',
});

export function generateMetadata(): Metadata {
  const { identity } = loadWebProductConfig({ ...process.env });
  return {
    title: `${identity.displayName} Remote`,
    description: `Browser remote client for a ${identity.displayName} session`,
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>): ReactElement {
  return (
    <html lang="en" className="h-full">
      <body className={`h-full ${ibmPlexSans.variable} ${ibmPlexMono.variable}`}>
        {/* /remote (the only route this app hosts) already renders its own `main`
            landmark — `RemoteClient` owns it in every state, including `ConversationView`'s own once
            a conversation starts. A `main` here too would nest one `main` inside another, which a
            shared root layout has no way to know is safe for a given route. Layout stays a plain,
            unlandmarked wrapper. */}
        <div className="h-full">{children}</div>
      </body>
    </html>
  );
}

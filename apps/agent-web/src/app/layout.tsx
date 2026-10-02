import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import { loadWebProductConfig } from '../lib/product-config';

import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';
import './globals.css';

// Shared typography for the remote surface.
const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export function generateMetadata(): Metadata {
  const { identity } = loadWebProductConfig({ ...process.env });
  return { title: `${identity.displayName} Remote`, description: `Browser remote client for a ${identity.displayName} session` };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>): ReactElement {
  return (
    <html lang="en" className="h-full">
      <body className={`h-full ${ibmPlexSans.variable} ${ibmPlexMono.variable}`}>
        {/* #3289 §3 review: /remote (the only route this app hosts) already renders its own `main`
            landmark — `RemoteClient` owns it in every state, including `ConversationView`'s own once
            a conversation starts. A `main` here too would nest one `main` inside another, which a
            shared root layout has no way to know is safe for a given route. Layout stays a plain,
            unlandmarked wrapper. */}
        <div className="h-full">{children}</div>
      </body>
    </html>
  );
}

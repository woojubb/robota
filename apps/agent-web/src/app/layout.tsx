import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';

import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';
import './globals.css';

// BRAND-002: unified Robota brand uses IBM Plex Sans/Mono (was Space Grotesk / Fira Code).
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

export const metadata: Metadata = {
  title: 'Robota Remote',
  description: 'Browser remote client for a Robota session',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>): ReactElement {
  return (
    <html lang="en" className="h-full">
      <body className={`h-full ${ibmPlexSans.variable} ${ibmPlexMono.variable}`}>
        {/* #3289 §3 review: every route mounted here already renders its own `main` landmark
            (`ConversationView` on /remote, `PlaygroundApp` on /playground) — a `main` here too would
            nest one `main` inside another, which a shared root layout has no way to know is safe for
            a given route. Layout stays a plain, unlandmarked wrapper. */}
        <div className="h-full">{children}</div>
      </body>
    </html>
  );
}

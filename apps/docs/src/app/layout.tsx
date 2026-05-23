import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans, JetBrains_Mono } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import './globals.css';

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-mono-display',
  display: 'swap',
});

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-code',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Robota Docs',
    template: '%s | Robota Docs',
  },
  description:
    'Documentation for Robota — open-source AI agent SDK and CLI with multi-provider support.',
  metadataBase: new URL('https://docs.robota.io'),
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://docs.robota.io',
    siteName: 'Robota Docs',
    title: 'Robota Docs',
    description:
      'Documentation for Robota — open-source AI agent SDK and CLI with multi-provider support.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${ibmPlexMono.variable} ${ibmPlexSans.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}

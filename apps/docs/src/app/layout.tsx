import type { Metadata } from 'next';
import { ThemeProvider } from 'next-themes';
import './globals.css';

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
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}

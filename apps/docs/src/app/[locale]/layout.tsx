import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans, JetBrains_Mono } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import '../globals.css';

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
    url: 'https://docs.robota.io',
    siteName: 'Robota Docs',
    title: 'Robota Docs',
    description:
      'Documentation for Robota — open-source AI agent SDK and CLI with multi-provider support.',
  },
};

export function generateStaticParams() {
  return [{ locale: 'en' }, { locale: 'ko' }];
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${ibmPlexMono.variable} ${ibmPlexSans.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

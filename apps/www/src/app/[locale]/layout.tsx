import type { Metadata } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ibm-plex-sans',
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Robota — Open-Source AI Agent SDK',
    template: '%s | Robota',
  },
  description:
    'Open-source AI agent SDK and CLI. Multi-provider BYOK — Anthropic, OpenAI, DeepSeek, Gemini, or local models. Dual-licensed: AGPL-3.0 & commercial.',
  metadataBase: new URL('https://robota.io'),
  openGraph: {
    type: 'website',
    url: 'https://robota.io',
    siteName: 'Robota',
    title: 'Robota — Open-Source AI Agent SDK',
    description:
      'Open-source AI agent SDK and CLI. Multi-provider BYOK — Anthropic, OpenAI, DeepSeek, Gemini, or local models. Dual-licensed: AGPL-3.0 & commercial.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Robota — Open-Source AI Agent SDK',
    description:
      'Open-source AI agent SDK and CLI. Multi-provider BYOK — Anthropic, OpenAI, DeepSeek, Gemini, or local models. Dual-licensed: AGPL-3.0 & commercial.',
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
      className={`${ibmPlexSans.variable} ${ibmPlexMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <NextIntlClientProvider messages={messages}>
          <Header />
          <main>{children}</main>
          <Footer />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

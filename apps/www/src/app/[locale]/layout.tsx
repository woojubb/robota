import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

export const metadata: Metadata = {
  title: {
    default: 'Robota — Open-Source AI Agent SDK',
    template: '%s | Robota',
  },
  description:
    'Open-source AI agent SDK and CLI. Multi-provider BYOK — Anthropic, OpenAI, DeepSeek, Gemini, or local models. Dual-licensed: AGPL-3.0 & commercial.',
  metadataBase: new URL('https://www.robota.io'),
  openGraph: {
    type: 'website',
    url: 'https://www.robota.io',
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
    <html lang={locale} suppressHydrationWarning>
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

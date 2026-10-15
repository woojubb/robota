import type { ReactNode } from 'react';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { Header } from './Header';
import { Footer } from './Footer';
import { getMarketingHomeGraph, type MarketingLocale } from '../lib/marketing';
import en from '../messages/en.json';
import ko from '../messages/ko.json';

const sans = IBM_Plex_Sans({
  subsets: ['latin'], weight: ['400', '500', '600', '700'],
  variable: '--font-ibm-plex-sans', display: 'swap',
});
const mono = IBM_Plex_Mono({
  subsets: ['latin'], weight: ['400'],
  variable: '--font-ibm-plex-mono', display: 'swap',
});

export function MarketingDocument({ locale, children }: { locale: MarketingLocale; children: ReactNode }) {
  const messages = locale === 'ko' ? ko : en;
  return (
    <html lang={locale} className={`${sans.variable} ${mono.variable}`}>
      <body>
        <NextIntlClientProvider locale={locale} messages={{ common: messages.common }}>
          <Header />
          <main id="main-content">{children}</main>
          <Footer />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

export function MarketingHomeSchema({ locale }: { locale: MarketingLocale }) {
  const graph = getMarketingHomeGraph(locale);
  return graph ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(graph).replace(/</gu, '\\u003c') }} /> : null;
}

import type { ReactNode } from 'react';
import localFont from 'next/font/local';
import { NextIntlClientProvider } from 'next-intl';
import { Header } from './Header';
import { Footer } from './Footer';
import { SiteAnalytics } from './SiteAnalytics';
import { productPublicConfig } from '../lib/product-config.generated';
import { getMarketingHomeGraph, type MarketingLocale } from '../lib/marketing';
import en from '../messages/en.json';
import ko from '../messages/ko.json';

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
  variable: '--font-ibm-plex-sans',
  display: 'swap',
});
const ibmPlexMono = localFont({
  src: [
    {
      path: '../fonts/ibm-plex-mono/ibm-plex-mono-latin-400-normal.woff2',
      weight: '400',
      style: 'normal',
    },
  ],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
});

export function MarketingDocument({ locale, children }: { locale: MarketingLocale; children: ReactNode }) {
  const messages = locale === 'ko' ? ko : en;
  return (
    <html lang={locale} className={`${ibmPlexSans.variable} ${ibmPlexMono.variable}`}>
      <body>
        <NextIntlClientProvider locale={locale} messages={{ common: messages.common }}>
          <Header />
          <main id="main-content">{children}</main>
          <Footer />
          <SiteAnalytics measurementId={productPublicConfig.services?.analyticsMeasurementId} locale={locale} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

export function MarketingHomeSchema({ locale }: { locale: MarketingLocale }) {
  const graph = getMarketingHomeGraph(locale);
  return graph ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(graph).replace(/</gu, '\\u003c') }} /> : null;
}

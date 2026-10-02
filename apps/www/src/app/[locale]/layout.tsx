import type { Metadata } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { productPublicConfig } from '@/lib/product-config.generated';

const productName = productPublicConfig.identity.displayName;
const websiteUrl = productPublicConfig.identity.websiteUrl;

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
    default: `${productName} — An Adaptable Foundation for AI Agents`,
    template: `%s | ${productName}`,
  },
  description:
    'Our agents develop and advance our agents. Building toward dependable self-development on an adaptable foundation. Today: a multi-provider CLI and embeddable SDK. AGPL-3.0 & commercial.',
  ...(websiteUrl ? { metadataBase: new URL(websiteUrl) } : {}),
  openGraph: {
    type: 'website',
    ...(websiteUrl ? { url: websiteUrl } : {}),
    siteName: productName,
    title: `${productName} — An Adaptable Foundation for AI Agents`,
    description:
      'Our agents develop and advance our agents. Building toward dependable self-development on an adaptable foundation. Today: a multi-provider CLI and embeddable SDK. AGPL-3.0 & commercial.',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${productName} — An Adaptable Foundation for AI Agents`,
    description:
      'Our agents develop and advance our agents. Building toward dependable self-development on an adaptable foundation. Today: a multi-provider CLI and embeddable SDK. AGPL-3.0 & commercial.',
  },
};

// SEO-001: structured data so search engines understand the product.
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: productName,
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Cross-platform',
  description:
    'An adaptable foundation for AI agents, delivered through a multi-provider CLI and embeddable SDK. Our direction: our agents develop and advance our agents.',
  ...(websiteUrl ? { url: websiteUrl } : {}),
  license: 'https://www.gnu.org/licenses/agpl-3.0.html',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</gu, '\\u003c') }}
        />
        <NextIntlClientProvider messages={messages}>
          <Header />
          <main>{children}</main>
          <Footer />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

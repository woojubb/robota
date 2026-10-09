import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { ThemeProvider } from 'next-themes';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { productPublicConfig } from '@/lib/product-config.generated';
import '../globals.css';

const productName = productPublicConfig.identity.displayName;
const docsUrl = productPublicConfig.identity.docsUrl;

const ibmPlexMono = localFont({
  src: [
    {
      path: '../../fonts/ibm-plex-mono/ibm-plex-mono-latin-400-normal.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../../fonts/ibm-plex-mono/ibm-plex-mono-latin-500-normal.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../../fonts/ibm-plex-mono/ibm-plex-mono-latin-600-normal.woff2',
      weight: '600',
      style: 'normal',
    },
    {
      path: '../../fonts/ibm-plex-mono/ibm-plex-mono-latin-700-normal.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-mono-display',
  display: 'swap',
});

const ibmPlexSans = localFont({
  src: [
    {
      path: '../../fonts/ibm-plex-sans/ibm-plex-sans-latin-300-normal.woff2',
      weight: '300',
      style: 'normal',
    },
    {
      path: '../../fonts/ibm-plex-sans/ibm-plex-sans-latin-400-normal.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../../fonts/ibm-plex-sans/ibm-plex-sans-latin-500-normal.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../../fonts/ibm-plex-sans/ibm-plex-sans-latin-600-normal.woff2',
      weight: '600',
      style: 'normal',
    },
  ],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = localFont({
  src: [
    {
      path: '../../fonts/jetbrains-mono/jetbrains-mono-latin-400-normal.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../../fonts/jetbrains-mono/jetbrains-mono-latin-500-normal.woff2',
      weight: '500',
      style: 'normal',
    },
  ],
  variable: '--font-code',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: `${productName} Documentation`,
    template: `%s | ${productName} Documentation`,
  },
  description: `Documentation for ${productName} — open-source AI agent SDK and CLI with multi-provider support.`,
  ...(docsUrl ? { metadataBase: new URL(docsUrl) } : {}),
  openGraph: {
    type: 'website',
    ...(docsUrl ? { url: docsUrl } : {}),
    siteName: `${productName} Documentation`,
    title: `${productName} Documentation`,
    description: `Documentation for ${productName} — open-source AI agent SDK and CLI with multi-provider support.`,
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

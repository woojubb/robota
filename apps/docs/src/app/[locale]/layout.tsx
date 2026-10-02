import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans, JetBrains_Mono } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { productPublicConfig } from '@/lib/product-config.generated';
import '../globals.css';

const productName = productPublicConfig.identity.displayName;
const docsUrl = productPublicConfig.identity.docsUrl;

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
    default: `${productName} Documentation`,
    template: `%s | ${productName} Documentation`,
  },
  description:
    `Documentation for ${productName} — open-source AI agent SDK and CLI with multi-provider support.`,
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

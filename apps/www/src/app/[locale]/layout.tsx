import '../globals.css';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { MarketingDocument } from '../../components/MarketingDocument';
import { productPublicConfig } from '../../lib/product-config.generated';

const name = productPublicConfig.identity.displayName;
export const metadata: Metadata = {
  title: { default: name, template: name ? `%s | ${name}` : '%s' },
};
export const dynamicParams = false;

export function generateStaticParams() {
  return [{ locale: 'en' }, { locale: 'ko' }];
}

export default async function LocaleLayout({ children, params }: {
  children: React.ReactNode; params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (locale !== 'en' && locale !== 'ko') notFound();
  setRequestLocale(locale);
  return <MarketingDocument locale={locale}>{children}</MarketingDocument>;
}

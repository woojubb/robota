import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { HomePageContent } from '../../components/HomePageContent';
import { MarketingHomeSchema } from '../../components/MarketingDocument';
import { getMarketingMetadata } from '../../lib/marketing';

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: PageProps) {
  const { locale } = await params;
  if (locale !== 'en' && locale !== 'ko') notFound();
  return getMarketingMetadata(locale, 'home');
}

export default async function HomePage({ params }: PageProps) {
  const { locale } = await params;
  if (locale !== 'en' && locale !== 'ko') notFound();
  setRequestLocale(locale);
  return <><MarketingHomeSchema locale={locale} /><HomePageContent locale={locale} /></>;
}

import { setRequestLocale } from 'next-intl/server';
import { HomePageContent } from '../../components/HomePageContent';
import { MarketingHomeSchema } from '../../components/MarketingDocument';
import { getMarketingMetadata } from '../../lib/marketing';

export function generateMetadata() {
  return getMarketingMetadata('en', 'home');
}

export default function HomePage() {
  setRequestLocale('en');
  return <><MarketingHomeSchema locale="en" /><HomePageContent locale="en" /></>;
}

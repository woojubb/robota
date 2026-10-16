import '../globals.css';
import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { MarketingDocument } from '../../components/MarketingDocument';
import { productPublicConfig } from '../../lib/product-config.generated';

const name = productPublicConfig.identity.displayName;
export const metadata: Metadata = {
  title: { default: name, template: name ? `%s | ${name}` : '%s' },
};

export default function EnglishLayout({ children }: { children: React.ReactNode }) {
  setRequestLocale('en');
  return <MarketingDocument locale="en">{children}</MarketingDocument>;
}

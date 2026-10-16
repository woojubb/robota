import type { MetadataRoute } from 'next';
import { routing } from '@/i18n/routing';
import { productPublicConfig } from '@/lib/product-config.generated';
import { marketingPages, marketingPath } from '../lib/marketing';

// SEO-001. Static export: emitted as /sitemap.xml at build time.
export const dynamic = 'force-static';

const BASE = productPublicConfig.identity.websiteUrl?.replace(/\/+$/u, '');

export default function sitemap(): MetadataRoute.Sitemap {
  if (!BASE) return [];
  return routing.locales.flatMap((locale) =>
    marketingPages.map((page) => ({
      url: `${BASE}${marketingPath(locale, page)}`,
      changeFrequency: 'weekly' as const,
      priority: page === 'home' ? 1 : 0.7,
    })),
  );
}

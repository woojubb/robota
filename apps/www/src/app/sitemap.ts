import type { MetadataRoute } from 'next';
import { routing } from '@/i18n/routing';
import { productPublicConfig } from '@/lib/product-config.generated';

// SEO-001. Static export: emitted as /sitemap.xml at build time.
export const dynamic = 'force-static';

const BASE = productPublicConfig.identity.websiteUrl;
const ROUTES = ['', '/beta', '/enterprise', '/roadmap', '/compare', '/showcase'];

export default function sitemap(): MetadataRoute.Sitemap {
  if (!BASE) return [];
  return routing.locales.flatMap((locale) =>
    ROUTES.map((route) => ({
      url: `${BASE}/${locale}${route}`,
      changeFrequency: 'weekly' as const,
      priority: route === '' ? 1 : 0.7,
    })),
  );
}

import type { MetadataRoute } from 'next';
import { productPublicConfig } from '@/lib/product-config.generated';

// SEO-001. Static export: emitted as /robots.txt at build time.
export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  const websiteUrl = productPublicConfig.identity.websiteUrl;
  return {
    rules: { userAgent: '*', allow: '/' },
    ...(websiteUrl ? { sitemap: `${websiteUrl}/sitemap.xml`, host: websiteUrl } : {}),
  };
}

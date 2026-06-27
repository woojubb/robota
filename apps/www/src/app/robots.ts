import type { MetadataRoute } from 'next';

// SEO-001. Static export: emitted as /robots.txt at build time.
export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: 'https://robota.io/sitemap.xml',
    host: 'https://robota.io',
  };
}

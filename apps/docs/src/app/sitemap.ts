import type { MetadataRoute } from 'next';

import { getAllSlugs } from '@/lib/content';
import { buildSitemapEntries } from '@/lib/sitemap';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  return buildSitemapEntries(getAllSlugs());
}

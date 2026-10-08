import { productPublicConfig } from './product-config.generated';

export const SITE_URL = productPublicConfig.identity.docsUrl;
export const SITE_LOCALES = ['en', 'ko'] as const;

export interface ISitemapEntry {
  url: string;
}

/** One sitemap entry per page per locale, in the trailing-slash form the static export serves. */
export function buildSitemapEntries(
  slugs: string[][],
  siteUrl: string | undefined = SITE_URL,
): ISitemapEntry[] {
  if (!siteUrl) return [];
  const baseUrl = siteUrl.replace(/\/+$/u, '');
  const entries: ISitemapEntry[] = [];
  for (const locale of SITE_LOCALES) {
    for (const slug of slugs) {
      const route = slug.length === 0 ? '' : `${slug.join('/')}/`;
      entries.push({ url: `${baseUrl}/${locale}/${route}` });
    }
  }
  return entries;
}

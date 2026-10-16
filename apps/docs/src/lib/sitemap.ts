import { productPublicConfig } from './product-config.generated';
import { resolvePageLanguage } from './content';

export const SITE_URL = productPublicConfig.identity.docsUrl;
export const SITE_LOCALES = ['en', 'ko'] as const;

export interface ISitemapEntry {
  url: string;
}

export function buildDocsPageUrl(siteUrl: string, locale: string, slug: string[]): string {
  const baseUrl = siteUrl.replace(/\/+$/u, '');
  const route = slug.length === 0 ? '' : `${slug.join('/')}/`;
  return `${baseUrl}/${locale}/${route}`;
}

/** One sitemap entry per available content locale, in the trailing-slash form the static export serves. */
export function buildSitemapEntries(
  slugs: string[][],
  siteUrl: string | undefined = SITE_URL,
): ISitemapEntry[] {
  if (!siteUrl) return [];
  const entries: ISitemapEntry[] = [];
  for (const locale of SITE_LOCALES) {
    for (const slug of slugs) {
      if (!resolvePageLanguage(slug, locale).availableLocales.includes(locale)) continue;
      entries.push({ url: buildDocsPageUrl(siteUrl, locale, slug) });
    }
  }
  return entries;
}

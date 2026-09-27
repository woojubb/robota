export const SITE_URL = 'https://docs.robota.io';
export const SITE_LOCALES = ['en', 'ko'] as const;

export interface ISitemapEntry {
  url: string;
}

/** One sitemap entry per page per locale, in the trailing-slash form the static export serves. */
export function buildSitemapEntries(slugs: string[][], siteUrl: string = SITE_URL): ISitemapEntry[] {
  const entries: ISitemapEntry[] = [];
  for (const locale of SITE_LOCALES) {
    for (const slug of slugs) {
      const route = slug.length === 0 ? '' : `${slug.join('/')}/`;
      entries.push({ url: `${siteUrl}/${locale}/${route}` });
    }
  }
  return entries;
}

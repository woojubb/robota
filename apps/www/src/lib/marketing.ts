import type { Metadata } from 'next';
import enMetadata from '@/messages/metadata/en.json';
import koMetadata from '@/messages/metadata/ko.json';
import { productPublicConfig } from './product-config.generated';

export type MarketingLocale = 'en' | 'ko';
export type MarketingPage = 'home' | 'beta' | 'enterprise' | 'roadmap' | 'compare' | 'showcase';

export const marketingPages: readonly MarketingPage[] = [
  'home', 'beta', 'enterprise', 'roadmap', 'compare', 'showcase',
];

export function marketingPath(locale: MarketingLocale, page: MarketingPage = 'home'): string {
  return page === 'home' ? (locale === 'en' ? '/' : '/ko') : `/${locale}/${page}`;
}

export function getMarketingLocaleUrl(pathname: string, locale: MarketingLocale): string {
  const boundary = pathname.search(/[?#]/u);
  const path = boundary < 0 ? pathname : pathname.slice(0, boundary);
  const suffix = boundary < 0 ? '' : pathname.slice(boundary);
  const childPath = path.replace(/^\/(?:en|ko)(?=\/|$)/u, '').replace(/\/+$/u, '');
  return `${childPath ? `/${locale}${childPath}` : marketingPath(locale)}${suffix}`;
}

/** Page titles and descriptions per locale; `{name}` stands for the product's display name. */
const metadataCopy: Record<MarketingLocale, Record<MarketingPage, { title: string; description: string }>> = {
  en: enMetadata,
  ko: koMetadata,
};

export function marketingCopy(locale: MarketingLocale, page: MarketingPage) {
  const name = productPublicConfig.identity.displayName;
  const { title, description } = metadataCopy[locale][page];
  return { title: title.replaceAll('{name}', name), description: description.replaceAll('{name}', name) };
}

export function getMarketingMetadata(locale: MarketingLocale, page: MarketingPage): Metadata {
  const { title, description } = marketingCopy(locale, page);
  const { displayName, websiteUrl } = productPublicConfig.identity;
  const image = `/og-${locale}.png`;
  const publicUrl = (path: string) => new URL(path, websiteUrl).toString();
  const openGraph = {
    type: 'website' as const,
    title, description,
    ...(displayName ? { siteName: displayName } : {}),
    locale: locale === 'ko' ? 'ko_KR' : 'en_US',
    alternateLocale: [locale === 'ko' ? 'en_US' : 'ko_KR'],
    ...(websiteUrl ? { images: [{ url: publicUrl(image), width: 1200, height: 630, alt: title }] } : {}),
  };
  const twitter = {
    card: 'summary_large_image' as const,
    title, description,
    ...(websiteUrl ? { images: [publicUrl(image)] } : {}),
  };
  return {
    title: page === 'home' ? { absolute: title } : title,
    description, openGraph, twitter,
    ...(websiteUrl ? {
      metadataBase: new URL(websiteUrl),
      alternates: {
        canonical: publicUrl(marketingPath(locale, page)),
        languages: {
          en: publicUrl(marketingPath('en', page)),
          ko: publicUrl(marketingPath('ko', page)),
          'x-default': publicUrl(marketingPath('en', page)),
        },
      },
      openGraph: { ...openGraph, url: publicUrl(marketingPath(locale, page)) },
    } : {}),
  };
}

export function getMarketingPageGraph(locale: MarketingLocale, page: MarketingPage = 'home') {
  const { displayName, websiteUrl, repositoryUrl, docsUrl } = productPublicConfig.identity;
  if (!websiteUrl) return null;
  const rootUrl = new URL('/', websiteUrl).toString();
  const pageUrl = new URL(marketingPath(locale, page), websiteUrl).toString();
  const { title, description } = marketingCopy(locale, page);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': `${rootUrl}#website`, url: rootUrl, name: displayName, inLanguage: ['en', 'ko'] },
      {
        '@type': 'WebPage', '@id': `${pageUrl}#webpage`, url: pageUrl,
        name: title, description, inLanguage: locale,
        isPartOf: { '@id': `${rootUrl}#website` },
        about: { '@id': `${rootUrl}#software` },
        ...(page !== 'home' ? { breadcrumb: { '@id': `${pageUrl}#breadcrumb` } } : {}),
      },
      {
        '@type': 'SoftwareApplication', '@id': `${rootUrl}#software`,
        name: displayName, url: rootUrl,
        applicationCategory: 'DeveloperApplication', operatingSystem: 'Cross-platform',
        license: 'https://www.gnu.org/licenses/agpl-3.0.html',
        ...(repositoryUrl ? { sameAs: [repositoryUrl], isBasedOn: { '@id': `${rootUrl}#source` } } : {}),
        ...(docsUrl ? { softwareHelp: { '@type': 'WebPage', url: docsUrl } } : {}),
      },
      ...(repositoryUrl ? [{
        '@type': 'SoftwareSourceCode', '@id': `${rootUrl}#source`,
        name: displayName, codeRepository: repositoryUrl,
        programmingLanguage: 'TypeScript', runtimePlatform: 'Node.js 22.12 or later',
        targetProduct: { '@id': `${rootUrl}#software` },
        license: 'https://www.gnu.org/licenses/agpl-3.0.html',
      }] : []),
      ...(page !== 'home' ? [{
        '@type': 'BreadcrumbList', '@id': `${pageUrl}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: displayName, item: new URL(marketingPath(locale), websiteUrl).toString() },
          { '@type': 'ListItem', position: 2, name: title, item: pageUrl },
        ],
      }] : []),
    ],
  };
}

export const getMarketingHomeGraph = (locale: MarketingLocale) => getMarketingPageGraph(locale);

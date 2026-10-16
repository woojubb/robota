import type { Metadata } from 'next';
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

function marketingCopy(locale: MarketingLocale, page: MarketingPage) {
  const name = productPublicConfig.identity.displayName;
  const copy = {
    en: {
      home: {
        title: `${name} — TypeScript AI Agent SDK and Coding CLI`,
        description: `Build AI agents with ${name}’s TypeScript SDK, or use the coding CLI built from the same public components. Public beta.`,
      },
      beta: { title: 'Public Beta', description: `Try the public ${name} SDK and coding CLI, review setup requirements, and share feedback on GitHub.` },
      enterprise: { title: 'Commercial Licensing and Deployment', description: `Review ${name}’s AGPL and commercial licensing, local deployment options, and the data flows to verify for your environment.` },
      roadmap: { title: 'Roadmap', description: `See shipped beta work, planned releases, and exploratory ideas for the ${name} SDK and CLI.` },
      compare: { title: `Why ${name}?`, description: `Explore ${name}’s TypeScript agent SDK, coding CLI, provider options, local models and licensing.` },
      showcase: { title: `${name} CLI Reference Implementation`, description: `Inspect the first-party ${name} CLI built with public SDK packages, and learn how to submit a working community project.` },
    },
    ko: {
      home: { title: `${name} — TypeScript AI 에이전트 SDK와 코딩 CLI`, description: `${name}의 TypeScript SDK로 AI 에이전트를 만들거나, 같은 공개 구성 요소로 만든 코딩 CLI를 사용하세요. 공개 베타입니다.` },
      beta: { title: '공개 베타', description: `${name} SDK와 코딩 CLI를 사용해 보고, 준비 사항을 확인한 뒤 GitHub에 의견을 남기세요.` },
      enterprise: { title: '상업용 라이선스와 배포', description: `${name}의 AGPL 및 상업용 라이선스, 로컬 배포 옵션과 환경별 데이터 흐름을 확인하세요.` },
      roadmap: { title: '로드맵', description: `${name} SDK와 CLI의 완료된 베타 작업, 향후 계획, 탐색 중인 아이디어를 구분해 살펴보세요.` },
      compare: { title: `왜 ${name}인가?`, description: `${name}의 TypeScript 에이전트 SDK와 코딩 CLI, 프로바이더 선택지, 로컬 모델 및 라이선스를 살펴보세요.` },
      showcase: { title: `${name} CLI 참조 구현`, description: `공개 SDK 패키지로 만든 ${name} 팀의 CLI 참조 구현을 살펴보고, 작동하는 커뮤니티 프로젝트의 제출 방법을 확인하세요.` },
    },
  };
  return copy[locale][page];
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

export function getMarketingHomeGraph(locale: MarketingLocale) {
  const { displayName, websiteUrl } = productPublicConfig.identity;
  if (!websiteUrl) return null;
  const rootUrl = new URL('/', websiteUrl).toString();
  const pageUrl = new URL(marketingPath(locale), websiteUrl).toString();
  const { title, description } = marketingCopy(locale, 'home');
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': `${rootUrl}#website`, url: rootUrl, name: displayName, inLanguage: ['en', 'ko'] },
      {
        '@type': 'WebPage', '@id': `${pageUrl}#webpage`, url: pageUrl,
        name: title, description, inLanguage: locale,
        isPartOf: { '@id': `${rootUrl}#website` },
        about: { '@id': `${rootUrl}#software` },
      },
      {
        '@type': 'SoftwareApplication', '@id': `${rootUrl}#software`,
        name: displayName, url: rootUrl,
        applicationCategory: 'DeveloperApplication', operatingSystem: 'Cross-platform',
        license: 'https://www.gnu.org/licenses/agpl-3.0.html',
      },
    ],
  };
}

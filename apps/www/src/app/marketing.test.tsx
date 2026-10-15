import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Metadata } from 'next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../messages/en.json';
import ko from '../messages/ko.json';

type Namespace = keyof typeof en;

const request = vi.hoisted(() => ({ locale: 'en', pathname: '/' }));
vi.mock('../lib/product-config.generated', () => ({
  productPublicConfig: {
    identity: {
      displayName: 'Example Product',
      cliName: 'example',
      websiteUrl: 'https://example.test/',
      docsUrl: 'https://docs.example.test/',
      repositoryUrl: 'https://github.com/example/product',
    },
  },
}));
vi.mock('next/font/google', () => ({
  IBM_Plex_Sans: () => ({ variable: 'sans' }),
  IBM_Plex_Mono: () => ({ variable: 'mono' }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => request.pathname,
  useRouter: () => ({ push: () => {} }),
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));
vi.mock('next-intl', async (importOriginal) => {
  const original = await importOriginal<typeof import('next-intl')>();
  return {
    ...original,
    NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
    useLocale: () => request.locale,
    useTranslations: (namespace: Namespace) => original.createTranslator({
      locale: request.locale,
      messages: request.locale === 'ko' ? ko : en,
      namespace,
    }),
  };
});
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    setRequestLocale: (locale: string) => { request.locale = locale; },
    getTranslations: async (input: Namespace | { locale?: string; namespace?: Namespace }) => {
      const locale = typeof input === 'object' ? (input.locale ?? request.locale) : request.locale;
      return createTranslator({
        locale, messages: locale === 'ko' ? ko : en,
        namespace: typeof input === 'string' ? input : input.namespace,
      });
    },
  };
});

import * as Root from './(home)/page';
import * as Home from './[locale]/page';
import * as Beta from './[locale]/beta/page';
import * as Enterprise from './[locale]/enterprise/page';
import * as Roadmap from './[locale]/roadmap/page';
import * as Compare from './[locale]/compare/page';
import * as Showcase from './[locale]/showcase/page';
import sitemap from './sitemap';
import { Header } from '../components/Header';
import { MarketingDocument } from '../components/MarketingDocument';

type Route = {
  metadata?: Metadata;
  generateMetadata?: (args: { params: Promise<{ locale: string }> }) => Metadata | Promise<Metadata>;
};
const routes = { home: Home, beta: Beta, enterprise: Enterprise, roadmap: Roadmap, compare: Compare, showcase: Showcase };
const path = (locale: string, page: string) => page === 'home' ? (locale === 'en' ? '/' : '/ko') : `/${locale}/${page}`;

afterEach(() => { request.locale = 'en'; request.pathname = '/'; });

it('serves useful English homepage HTML at the root without browser navigation', () => {
  const html = renderToStaticMarkup(<Root.default />);
  expect(html).toMatch(/<h1\b/);
  expect(html).toContain('SDK');
  expect(html).toContain('https://docs.example.test/en/guide/sdk/');
  expect(html).toContain('https://docs.example.test/en/getting-started/');
});

for (const locale of ['en', 'ko']) {
  describe(`${locale} marketing route ownership`, () => {
    for (const [page, module] of Object.entries(routes)) {
      it(`${page} owns its canonical and reciprocal language metadata`, async () => {
        const route = (page === 'home' && locale === 'en' ? Root : module) as Route;
        const metadata = route.generateMetadata ? await route.generateMetadata({ params: Promise.resolve({ locale }) }) : (route.metadata ?? {});
        const canonical = `https://example.test${path(locale, page)}`;
        expect(metadata).toMatchObject({
          alternates: {
            canonical,
            languages: { en: `https://example.test${path('en', page)}`, ko: `https://example.test${path('ko', page)}` },
          },
          openGraph: { url: canonical, locale: locale === 'ko' ? 'ko_KR' : 'en_US' },
        });
        expect(metadata.description).toBeTruthy();
        expect(JSON.stringify(metadata.openGraph)).toContain(`/og-${locale}.png`);
      });
    }
  });
}

it('lists only the twelve canonical marketing URLs', () => {
  const urls = sitemap().map((entry) => entry.url);
  expect(urls).toHaveLength(12);
  expect(new Set(urls).size).toBe(12);
  expect(urls.sort()).toEqual(['en', 'ko'].flatMap((locale) => Object.keys(routes).map((page) => `https://example.test${path(locale, page)}`)).sort());
});

it('links the English home and language alternative to their canonical destinations', () => {
  request.locale = 'ko'; request.pathname = '/ko';
  const koHeader = renderToStaticMarkup(<Header />);
  expect(koHeader).toMatch(/<a\b[^>]*href="\/"/);
  request.locale = 'en'; request.pathname = '/';
  const enHeader = renderToStaticMarkup(<Header />);
  expect(enHeader).toMatch(/<a\b[^>]*href="\/"/);
  expect(enHeader).toMatch(/<a\b[^>]*href="\/ko"/);
});

it('redirects only the English home aliases while preserving legacy documentation', () => {
  const redirects = readFileSync(new URL('../../public/_redirects', import.meta.url), 'utf8');
  const rules = redirects.split('\n').filter((line) => line && !line.startsWith('#')).map((line) => line.split(/\s+/));
  expect(rules).toContainEqual(['/en', '/', '301']);
  expect(rules).toContainEqual(['/en/', '/', '301']);
  expect(rules.filter(([source]) => source.startsWith('/en'))).toHaveLength(2);
  expect(rules).toContainEqual(['/guide/cli.html', '__PROJECT_DOCS_URL__/en/guide/cli/', '301']);
  expect(rules).toContainEqual(['/guide/*', '__PROJECT_DOCS_URL__/en/guide/:splat', '301']);
  expect(rules.some(([source]) => source === '/*' || source.includes('www.'))).toBe(false);
});

for (const locale of ['en', 'ko'] as const) {
  it(`renders one ${locale} document and main region around the complete homepage`, async () => {
    request.locale = locale;
    const page = locale === 'en' ? <Root.default /> : await Home.default({ params: Promise.resolve({ locale }) });
    const html = renderToStaticMarkup(<MarketingDocument locale={locale}>{page}</MarketingDocument>);
    expect(html.match(/<html\b/g)).toHaveLength(1);
    expect(html).toContain(`lang="${locale}"`);
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });
}

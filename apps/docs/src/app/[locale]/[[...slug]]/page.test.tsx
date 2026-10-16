import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import ko from '../../../messages/ko.json';

const request = vi.hoisted(() => ({ locale: 'en', pathname: '/en/' }));

vi.mock('@/lib/product-config.generated', () => ({
  productPublicConfig: {
    identity: { displayName: 'Fixture', docsUrl: 'https://docs.example.test' },
  },
}));

vi.mock('next-intl/server', () => ({
  setRequestLocale: (locale: string) => {
    request.locale = locale;
  },
  getTranslations: async (arg: string | { locale: string; namespace: string }) => {
    const locale = typeof arg === 'string' ? request.locale : arg.locale;
    const namespace = typeof arg === 'string' ? arg : arg.namespace;
    const messages = locale === 'ko' ? ko : en;
    const entries = messages[namespace as 'home' | 'nav'] as Record<string, string>;
    return (key: string) => entries[key];
  },
}));

vi.mock('next-intl', () => ({ useLocale: () => request.locale }));
vi.mock('next/navigation', () => ({
  usePathname: () => request.pathname,
  useRouter: () => ({ push: vi.fn() }),
  notFound: () => {
    throw new Error('Not Found');
  },
}));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    prefetch: _prefetch,
    ...props
  }: React.ComponentProps<'a'> & { prefetch?: boolean }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('next-mdx-remote/rsc', () => ({
  MDXRemote: ({ source }: { source: string }) => <div>{source.slice(0, 250)}</div>,
}));

import DocsPage, { generateMetadata, generateStaticParams } from './page';

const root = 'https://docs.example.test';

async function route(locale: 'en' | 'ko', slug: string[] = []) {
  request.locale = locale;
  request.pathname = `/${locale}/${slug.length ? `${slug.join('/')}/` : ''}`;
  const params = Promise.resolve({ locale, slug: slug.length ? slug : undefined });
  const metadata = await generateMetadata({ params });
  const html = renderToStaticMarkup(await DocsPage({ params }));
  return { metadata, html };
}

function expectSignals(
  metadata: Awaited<ReturnType<typeof generateMetadata>>,
  canonical: string,
  languages?: Record<'en' | 'ko', string>,
) {
  expect(metadata.alternates?.canonical).toBe(canonical);
  if (languages) {
    expect(metadata.alternates?.languages).toEqual(languages);
  } else {
    expect(metadata.alternates?.languages?.ko).toBeUndefined();
  }
  expect(metadata.openGraph?.url).toBe(canonical);
}

function logicalTitle(metadata: Awaited<ReturnType<typeof generateMetadata>>): string | undefined {
  if (typeof metadata.title === 'string') return metadata.title;
  if (metadata.title && 'absolute' in metadata.title) return metadata.title.absolute;
  return undefined;
}

describe('documentation route language signals from rendered sources', () => {
  it('keeps every existing Korean fallback URL exported', async () => {
    const params = await generateStaticParams();
    expect(params).toContainEqual({ locale: 'ko', slug: ['guide', 'cli'] });
    expect(params).toContainEqual({ locale: 'ko', slug: ['packages', 'agent-core'] });
  });

  it('gives the English guide an English canonical and no Korean switch', async () => {
    const { metadata, html } = await route('en', ['guide', 'cli']);
    expect(logicalTitle(metadata)).toBe('CLI Reference');
    expect(String(metadata.description)).toContain('coding-capable terminal interface');
    expectSignals(metadata, `${root}/en/guide/cli/`);
    expect(html).toMatch(/<article\b[^>]*lang="en"/u);
    const koreanSwitch = html.match(/<button\b[^>]*>KO<\/button>/u)?.[0];
    expect(!koreanSwitch || koreanSwitch.includes('disabled')).toBe(true);
  });

  it('marks the translated Korean guide as Korean and links both real versions', async () => {
    const { metadata, html } = await route('ko', ['getting-started']);
    expect(logicalTitle(metadata)).toBe('시작하기');
    expect(String(metadata.description)).toMatch(/[가-힣]/u);
    expectSignals(metadata, `${root}/ko/getting-started/`, {
      en: `${root}/en/getting-started/`,
      ko: `${root}/ko/getting-started/`,
    });
    expect(html).toMatch(/<article\b[^>]*lang="ko"/u);
    expect(html).toMatch(/aria-label="Switch language to English"/u);
  });

  it('keeps the Korean shell URL for an English guide but labels its article English', async () => {
    const { metadata, html } = await route('ko', ['guide', 'cli']);
    expect(logicalTitle(metadata)).toBe('CLI Reference');
    expectSignals(metadata, `${root}/en/guide/cli/`);
    expect(html).toMatch(/<article\b[^>]*lang="en"/u);
    expect(html).toMatch(/aria-label="Switch language to English"/u);
  });

  it.each(['en', 'ko'] as const)(
    'treats the %s package index and package article as English',
    async (locale) => {
      for (const slug of [['packages'], ['packages', 'agent-core']]) {
        const { metadata, html } = await route(locale, slug);
        expectSignals(metadata, `${root}/en/${slug.join('/')}/`);
        expect(html).toMatch(/<article\b[^>]*lang="en"/u);
        if (locale === 'en') {
          const koreanSwitch = html.match(/<button\b[^>]*>KO<\/button>/u)?.[0];
          expect(!koreanSwitch || koreanSwitch.includes('disabled')).toBe(true);
        }
        if (slug.length === 1) {
          expect(logicalTitle(metadata)).toBe('Packages');
          expect(String(metadata.description)).toContain('SDK package');
        } else {
          expect(logicalTitle(metadata)).toBe('agent-core Docs');
        }
      }
    },
  );

  it.each(['en', 'ko'] as const)(
    'describes the %s home from its rendered catalog',
    async (locale) => {
      const { metadata, html } = await route(locale);
      const messages = locale === 'ko' ? ko.home : en.home;
      expect(logicalTitle(metadata)).toContain(messages.titleHighlight);
      expect(metadata.description).toBe(messages.description);
      expectSignals(metadata, `${root}/${locale}/`, {
        en: `${root}/en/`,
        ko: `${root}/ko/`,
      });
      expect(html).toMatch(new RegExp(`<article\\b[^>]*lang="${locale}"`, 'u'));
      expect(html).toContain(messages.description);
      expect(html).toMatch(/aria-label="Switch language to (?:English|한국어)"/u);
    },
  );
});

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Metadata } from 'next';

import en from '../../../messages/en.json';
import ko from '../../../messages/ko.json';

const request = vi.hoisted(() => ({ locale: 'en' }));
const productIdentity = vi.hoisted(() => ({
  displayName: 'Example Product',
  websiteUrl: 'https://www.example.test' as string | undefined,
}));
vi.mock('../../../lib/product-config.generated', () => ({
  productPublicConfig: { identity: productIdentity },
}));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    setRequestLocale: (locale: string) => {
      request.locale = locale;
    },
    getTranslations: async (
      input?: 'compare' | { locale?: string; namespace?: 'compare' },
    ) => {
      const locale = typeof input === 'object' && input?.locale ? input.locale : request.locale;
      const namespace = typeof input === 'string' ? input : (input?.namespace ?? 'compare');
      return createTranslator({
        locale,
        messages: locale === 'ko' ? ko : en,
        namespace,
      });
    },
  };
});

import * as CompareRoute from './page';

const ComparePage = CompareRoute.default;
const metadataDescriptions = {
  en: 'Explore Example Product’s TypeScript agent SDK, coding CLI, provider options, local models and licensing.',
  ko: 'Example Product의 TypeScript 에이전트 SDK와 코딩 CLI, 프로바이더 선택지, 로컬 모델 및 라이선스를 살펴보세요.',
};

const routeExports = CompareRoute as unknown as {
  metadata?: Metadata;
  generateMetadata?: (args: {
    params: Promise<{ locale: string }>;
  }) => Promise<Metadata> | Metadata;
};

async function resolveRouteMetadata(locale: string): Promise<Metadata> {
  if (routeExports.generateMetadata) {
    return routeExports.generateMetadata({ params: Promise.resolve({ locale }) });
  }
  return routeExports.metadata ?? {};
}

afterEach(() => {
  productIdentity.websiteUrl = 'https://www.example.test';
});

for (const locale of ['en', 'ko'] as const) {
  describe(`product overview rendered in ${locale}`, () => {
    const messages = locale === 'en' ? en.compare : ko.compare;
    const selected = (value: string) => value.replaceAll('__PRODUCT_DISPLAY_NAME__', productIdentity.displayName);

    it('emits localized route metadata with reciprocal locale URLs', async () => {
      const metadata = await resolveRouteMetadata(locale);
      const canonical = `https://www.example.test/${locale}/compare`;

      expect(metadata).toMatchObject({
        title: selected(messages.title),
        description: metadataDescriptions[locale],
        alternates: {
          canonical,
          languages: {
            en: 'https://www.example.test/en/compare',
            ko: 'https://www.example.test/ko/compare',
          },
        },
        openGraph: {
          type: 'website',
          siteName: 'Example Product',
          title: selected(messages.title),
          description: metadataDescriptions[locale],
          url: canonical,
        },
        twitter: {
          card: 'summary_large_image',
          title: selected(messages.title),
          description: metadataDescriptions[locale],
        },
      });
    });

    it('keeps the product capabilities, proof links and getting-started CTA', async () => {
      const html = renderToStaticMarkup(await ComparePage({ params: Promise.resolve({ locale }) }));

      expect(html).toContain(messages.title);
      expect(html).toContain(messages.description);
      expect(html).toContain(messages.differentiators.title);
      expect(html.match(/<h3\b/g)).toHaveLength(4);
      for (const item of messages.differentiators.items) {
        expect(html).toContain(item.title);
        expect(html).toContain(item.body);
      }
      for (const href of [
        '__PROJECT_DOCS_URL__/en/guide/providers/',
        '__PROJECT_DOCS_URL__/en/guide/local-llm/',
        '__PROJECT_REPOSITORY_URL__/blob/main/LICENSING.md',
        `__PROJECT_DOCS_URL__/${locale}/getting-started/`,
      ]) {
        expect(html).toContain(`href="${href}"`);
      }
      expect(html).toContain(messages.tryButton);
    });

    it('omits the competitor matrix, alternatives and source notes', async () => {
      const html = renderToStaticMarkup(await ComparePage({ params: Promise.resolve({ locale }) }));

      expect(html).not.toMatch(/<table\b|<thead\b|<th\b/);
      expect(html).not.toMatch(/Claude Code|Cursor|Aider|Cline|ClineCore|@cline\/sdk/);
      expect(html).not.toContain('cline.bot');
      expect(html).not.toContain('docs.cline.bot');
    });
  });
}

it('omits public URL signals when the product identity has no website URL', async () => {
  productIdentity.websiteUrl = undefined;

  const metadata = await resolveRouteMetadata('en');

  expect(metadata.title).toBe(en.compare.title.replaceAll('__PRODUCT_DISPLAY_NAME__', productIdentity.displayName));
  expect(metadata.description).toBe(metadataDescriptions.en);
  expect(metadata.alternates).toBeUndefined();
  expect(metadata.openGraph).not.toHaveProperty('url');
});

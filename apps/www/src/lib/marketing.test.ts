import { afterEach, expect, it, vi } from 'vitest';

const identity = vi.hoisted(() => ({ displayName: 'Fixture', websiteUrl: 'https://example.test/' as string | undefined }));
vi.mock('./product-config.generated', () => ({ productPublicConfig: { identity } }));

import { getMarketingHomeGraph, getMarketingPageGraph, getMarketingLocaleUrl, getMarketingMetadata, marketingPages } from './marketing';
import { getLlmsIndex } from './llms';

afterEach(() => { identity.websiteUrl = 'https://example.test/'; });

it.each([
  ['/', 'ko', '/ko'],
  ['/en', 'en', '/'],
  ['/en/', 'ko', '/ko'],
  ['/ko/', 'en', '/'],
  ['/en/compare', 'ko', '/ko/compare'],
  ['/ko/enterprise', 'en', '/en/enterprise'],
  ['/ko?from=docs#start', 'en', '/?from=docs#start'],
] as const)('maps %s to the %s canonical language destination', (path, locale, expected) => {
  expect(getMarketingLocaleUrl(path, locale)).toBe(expected);
});

it('omits public identity URLs when the selected product has no website', () => {
  identity.websiteUrl = undefined;
  expect(getMarketingMetadata('ko', 'home')).not.toHaveProperty('alternates');
  expect(getMarketingMetadata('en', 'beta').openGraph).not.toHaveProperty('url');
  expect(getMarketingHomeGraph('en')).toBeNull();
  expect(getMarketingPageGraph('ko', 'enterprise')).toBeNull();
  expect(getLlmsIndex()).toBe('');
});

it('links every localized page and breadcrumb to the canonical homepage entity', () => {
  for (const locale of ['en', 'ko'] as const) {
    for (const page of marketingPages) {
      const { ['@graph']: graph } = getMarketingPageGraph(locale, page)!;
      const webpage = graph.find((node) => node['@type'] === 'WebPage')!;
      expect(webpage).toMatchObject({ inLanguage: locale, about: { '@id': 'https://example.test/#software' } });
      const breadcrumb = graph.find((node) => node['@type'] === 'BreadcrumbList');
      if (page === 'home') expect(breadcrumb).toBeUndefined();
      else expect(breadcrumb).toMatchObject({ itemListElement: [
        { position: 1, item: locale === 'en' ? 'https://example.test/' : 'https://example.test/ko' },
        { position: 2, item: `https://example.test/${locale}/${page}` },
      ] });
    }
  }
});

it('generates a bilingual discovery index with only the selected public identity', () => {
  const index = getLlmsIndex();
  expect(index).toContain('# Fixture');
  expect(index).toContain('https://example.test/ko');
  expect(index).toContain('https://example.test/en/enterprise');
  expect(index).not.toMatch(/robota\.io|github\.com|\{name\}/);
});

it('describes the site, localized homepage and shared software without unsupported claims', () => {
  const en = getMarketingHomeGraph('en')!;
  const ko = getMarketingHomeGraph('ko')!;
  expect(en['@graph'].map((node) => node['@type'])).toEqual(['WebSite', 'WebPage', 'SoftwareApplication']);
  expect(en['@graph'][1]).toMatchObject({ url: 'https://example.test/', inLanguage: 'en' });
  expect(ko['@graph'][1]).toMatchObject({ url: 'https://example.test/ko', inLanguage: 'ko' });
  expect(en['@graph'][2]['@id']).toBe(ko['@graph'][2]['@id']);
  expect(JSON.stringify(en)).not.toMatch(/aggregateRating|"offers"|"publisher"/);
});

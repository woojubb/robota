import { afterEach, expect, it, vi } from 'vitest';

const identity = vi.hoisted(() => ({ displayName: 'Fixture', websiteUrl: 'https://example.test/' as string | undefined }));
vi.mock('./product-config.generated', () => ({ productPublicConfig: { identity } }));

import { getMarketingHomeGraph, getMarketingLocaleUrl, getMarketingMetadata } from './marketing';

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

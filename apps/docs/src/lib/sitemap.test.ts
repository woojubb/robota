import { describe, expect, it } from 'vitest';

import { buildSitemapEntries } from './sitemap';

describe('buildSitemapEntries', () => {
  it('lists every page in every locale with the served trailing-slash URL', () => {
    const urls = buildSitemapEntries([
      [],
      ['guide'],
      ['guide', 'cli'],
      ['packages', 'agent-core'],
    ]).map((e) => e.url);

    expect(urls).toEqual([
      'https://docs.robota.io/en/',
      'https://docs.robota.io/en/guide/',
      'https://docs.robota.io/en/guide/cli/',
      'https://docs.robota.io/en/packages/agent-core/',
      'https://docs.robota.io/ko/',
      'https://docs.robota.io/ko/guide/',
      'https://docs.robota.io/ko/guide/cli/',
      'https://docs.robota.io/ko/packages/agent-core/',
    ]);
  });
});

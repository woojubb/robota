import { describe, expect, it } from 'vitest';

import { buildSitemapEntries } from './sitemap';

describe('buildSitemapEntries', () => {
  it('lists every page in every locale with the served trailing-slash URL', () => {
    const urls = buildSitemapEntries([
      [],
      ['guide'],
      ['guide', 'cli'],
      ['packages', 'agent-core'],
    ], 'https://docs.example.test').map((e) => e.url);

    expect(urls).toEqual([
      'https://docs.example.test/en/',
      'https://docs.example.test/en/guide/',
      'https://docs.example.test/en/guide/cli/',
      'https://docs.example.test/en/packages/agent-core/',
      'https://docs.example.test/ko/',
      'https://docs.example.test/ko/guide/',
      'https://docs.example.test/ko/guide/cli/',
      'https://docs.example.test/ko/packages/agent-core/',
    ]);
  });
});

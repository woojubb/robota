import { describe, expect, it } from 'vitest';

import { buildSitemapEntries } from './sitemap';

describe('buildSitemapEntries', () => {
  it('lists English pages and only genuinely translated Korean pages', () => {
    const urls = buildSitemapEntries(
      [[], ['getting-started'], ['guide', 'cli'], ['packages'], ['packages', 'agent-core']],
      'https://docs.example.test',
    ).map((e) => e.url);

    expect(urls).toEqual([
      'https://docs.example.test/en/',
      'https://docs.example.test/en/getting-started/',
      'https://docs.example.test/en/guide/cli/',
      'https://docs.example.test/en/packages/',
      'https://docs.example.test/en/packages/agent-core/',
      'https://docs.example.test/ko/',
      'https://docs.example.test/ko/getting-started/',
    ]);
  });
});

it('joins a normalized documentation base URL with one path separator', () => {
  expect(
    buildSitemapEntries([['guide']], 'https://docs.example.test/v1/').map((entry) => entry.url),
  ).toEqual(['https://docs.example.test/v1/en/guide/']);
});

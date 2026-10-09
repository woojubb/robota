import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import ko from '../../../messages/ko.json';

const request = vi.hoisted(() => ({ locale: 'en' }));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    setRequestLocale: (locale: string) => {
      request.locale = locale;
    },
    getTranslations: async () =>
      createTranslator({
        locale: request.locale,
        messages: request.locale === 'ko' ? ko : en,
        namespace: 'compare',
      }),
  };
});

import ComparePage from './page';

function clineCell(html: string, feature: string): string {
  const rows = html.match(/<tr\b[\s\S]*?<\/tr>/g) ?? [];
  const row = rows.find((value) => value.includes(feature.replaceAll('&', '&amp;')));
  expect(row, `missing feature row: ${feature}`).toBeDefined();
  const cells = row!.match(/<td\b[\s\S]*?<\/td>/g) ?? [];
  expect(cells).toHaveLength(6);
  return cells[5];
}

for (const locale of ['en', 'ko'] as const) {
  describe(`comparison rendered in ${locale}`, () => {
    const messages = locale === 'en' ? en.compare : ko.compare;

    it('names the product and explains CLI/SDK versus the bare class', async () => {
      const html = renderToStaticMarkup(await ComparePage({ params: Promise.resolve({ locale }) }));
      const headers = html.match(/<th\b[\s\S]*?<\/th>/g) ?? [];
      expect(headers[1]).toContain('__PRODUCT_DISPLAY_NAME__');
      expect(headers[1]).not.toContain('ConversationAgent');
      expect(html).toContain('ConversationAgent');
      expect(html).toContain('CLI');
      expect(html).toContain('SDK');
    });

    it('shows qualified Cline SDK, session and background support with official sources', async () => {
      const html = renderToStaticMarkup(await ComparePage({ params: Promise.resolve({ locale }) }));
      for (const index of [3, 7, 8]) {
        const cell = clineCell(html, messages.features[index]);
        expect(cell).toContain('✓');
        expect(cell).not.toContain('✗');
        expect(
          cell
            .replace(/<[^>]*>/g, '')
            .replace('✓', '')
            .trim(),
        ).not.toBe('');
      }
      expect(html).toContain('@cline/sdk');
      expect(html).toContain('ClineCore');
      expect(html).toContain('Agent');
      expect(html).toContain('Zen');
      for (const url of [
        'https://cline.bot/sdk',
        'https://docs.cline.bot/sdk/clinecore',
        'https://docs.cline.bot/core-workflows/task-management',
        'https://cline.bot/cli',
      ])
        expect(html).toContain(`href="${url}"`);
      expect(html).toContain(messages.claimSources.checkedOn);
      expect(html).toContain(messages.claimSources.taskLabel);
      expect(html).toContain(messages.claimSources.scope);
      expect(clineCell(html, messages.features[6])).toContain('✓');
      expect(html).not.toContain('delivered only as end-user products');
      expect(html).not.toContain('최종 사용자 제품으로만');
      expect(html).not.toContain('don&#x27;t need embedding or SDK usage');
      expect(html).not.toContain('임베드나 SDK 사용이 필요 없다면');
    });
  });
}

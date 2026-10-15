import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/product-config.generated', () => ({
  productPublicConfig: {
    identity: {
      displayName: 'Example Product',
      cliName: 'example-cli',
      docsUrl: 'https://docs.example.test',
      repositoryUrl: 'https://github.com/example/product',
    },
  },
}));

import { HomePageContent } from './HomePageContent';

describe('server rendered homepage content', () => {
  for (const locale of ['en', 'ko'] as const) {
    it(`explains both first tasks and their prerequisites in ${locale}`, () => {
      const html = renderToStaticMarkup(<HomePageContent locale={locale} />);

      expect(html.match(/<h1\b/g)).toHaveLength(1);
      expect(html).toContain('createQuery');
      expect(html).toContain('@robota-sdk/agent-framework');
      expect(html).toContain('npx @robota-sdk/agent-cli');
      expect(html).toContain('example-cli');
      expect(html).toContain('https://docs.example.test/en/guide/sdk/');
      expect(html).toContain(`https://docs.example.test/${locale}/getting-started/`);
      expect(html).toContain(`href="/${locale}/showcase"`);
      expect(html).toContain(`href="/${locale}/roadmap"`);
      expect(html).toContain('AGPL-3.0');
      expect(html).toContain('MCP');
      expect(html).not.toContain('__PRODUCT_');
    });
  }

  it('puts SDK and CLI actions in the English hero', () => {
    const html = renderToStaticMarkup(<HomePageContent locale="en" />);
    const hero = html.split('</section>')[0];

    expect(hero).toContain('One foundation for agents you use and agents you build.');
    expect(hero).toContain('Build with the SDK');
    expect(hero).toContain('Try the CLI');
    expect(hero).toContain('Our direction: agents that can reliably advance the systems they are built on.');
  });

  it('uses the approved Korean proposition and labels the English SDK guide', () => {
    const html = renderToStaticMarkup(<HomePageContent locale="ko" />);
    const hero = html.split('</section>')[0];

    expect(html).toContain('에이전트를 사용하고, 같은 기반으로 직접 만드세요.');
    expect(hero).toContain('SDK 가이드(영문)');
    expect(hero).toContain('에이전트가 자신의 시스템을 더 안정적으로 발전시킬 수 있는 기반을 만들어갑니다.');
  });

  for (const locale of ['en', 'ko'] as const) {
    it(`shows a normal CLI prompt and the expected first response in ${locale}`, () => {
      const html = renderToStaticMarkup(<HomePageContent locale={locale} />);
      const cliAside = html.split('class="home-cli-aside"')[1]?.split('</section>')[0];

      expect(cliAside).toBeDefined();
      expect(cliAside).toContain('Reply with one sentence.');
      expect(cliAside).toContain(locale === 'ko' ? '선택한 모델의 텍스트 응답' : 'a text reply from the selected model');
    });
  }
});

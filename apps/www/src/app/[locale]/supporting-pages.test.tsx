import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import en from '../../messages/en.json';
import ko from '../../messages/ko.json';

const request = vi.hoisted(() => ({ locale: 'en' }));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    setRequestLocale: (locale: string) => {
      request.locale = locale;
    },
    getTranslations: async (namespace: keyof typeof en) =>
      createTranslator({
        locale: request.locale,
        messages: request.locale === 'ko' ? ko : en,
        namespace,
      }),
  };
});

import BetaPage from './beta/page';
import EnterprisePage from './enterprise/page';
import RoadmapPage from './roadmap/page';
import ShowcasePage from './showcase/page';

async function markup(
  page: ({ params }: { params: Promise<{ locale: string }> }) => Promise<React.ReactNode>,
  locale: 'en' | 'ko',
): Promise<string> {
  return renderToStaticMarkup(await page({ params: Promise.resolve({ locale }) }));
}

describe.each(['en', 'ko'] as const)('%s supporting content', (locale) => {
  it('offers available public beta paths without a signup promise', async () => {
    const html = await markup(BetaPage, locale);
    expect(html).not.toMatch(/signups open soon|베타 신청 곧 공개/u);
    expect(html).toContain(`__PROJECT_DOCS_URL__/${locale}/getting-started/`);
    expect(html).toContain('__PROJECT_DOCS_URL__/en/guide/sdk/');
  });

  it('presents a working team contact path without invented adoption or support commitments', async () => {
    const html = await markup(EnterprisePage, locale);
    expect(html).not.toMatch(/used by engineering teams|엔지니어링 팀에서 사용됩니다|2 business days|영업일 기준 2일/u);
    expect(html).not.toMatch(/<a[^>]*>\s*<\/a>/u);
    expect(html).not.toMatch(/email project discussions|이메일을 보내/u);
  });

  it('labels the CLI as a first-party reference with a source link', async () => {
    const html = await markup(ShowcasePage, locale);
    expect(html).toContain('__PROJECT_REPOSITORY_URL__/tree/main/packages/agent-cli');
    expect(html).not.toMatch(/Robota team|Robota 팀/u);
    expect(html).toMatch(locale === 'ko' ? /프로젝트 팀/u : /project team/u);
  });

  it('distinguishes historical shipped work from current planning', async () => {
    const html = await markup(RoadmapPage, locale);
    expect(html).not.toMatch(/Reviewed regularly|정기적으로 검토됩니다|Active development|현재 개발 중/u);
    expect(html).not.toContain('v1.0.0');
    expect(html).toMatch(locale === 'ko' ? /릴리스 준비/u : /Release readiness/u);
    expect(html).toMatch(locale === 'ko' ? /이전 베타/u : /earlier beta/u);
  });
});

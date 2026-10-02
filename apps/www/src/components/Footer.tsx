'use client';

import { InternalLink } from './ui';
import { useLocale, useTranslations } from 'next-intl';
import { productPublicConfig } from '@/lib/product-config.generated';

export function Footer() {
  const t = useTranslations('common');
  const locale = useLocale();
  const externalLinks = [
    productPublicConfig.identity.docsUrl && {
      key: 'documentation',
      href: `${productPublicConfig.identity.docsUrl}/${locale}/`,
    },
    productPublicConfig.identity.docsUrl && {
      key: 'gettingStarted',
      href: `${productPublicConfig.identity.docsUrl}/${locale}/getting-started/`,
    },
    productPublicConfig.identity.repositoryUrl && {
      key: 'github',
      href: productPublicConfig.identity.repositoryUrl,
    },
  ].filter((link): link is { key: string; href: string } => Boolean(link));

  return (
    <footer className="border-t border-[var(--border)] bg-[var(--background)]">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <p className="text-lg font-bold text-[var(--foreground)]">{productPublicConfig.identity.displayName}</p>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">{t('footer.tagline')}</p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              {t('footer.product')}
            </p>
            <ul className="mt-3 space-y-2">
              <li>
                <InternalLink
                  href={`/${locale}/compare`}
                  className="inline-flex min-h-[44px] items-center text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                >
                  {t('footer.links.whyProduct')}
                </InternalLink>
              </li>
              <li>
                <InternalLink
                  href={`/${locale}/showcase`}
                  className="inline-flex min-h-[44px] items-center text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                >
                  {t('footer.links.showcase')}
                </InternalLink>
              </li>
              <li>
                <InternalLink
                  href={`/${locale}/roadmap`}
                  className="inline-flex min-h-[44px] items-center text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                >
                  {t('footer.links.roadmap')}
                </InternalLink>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              {t('footer.developers')}
            </p>
            <ul className="mt-3 space-y-2">
              {[
                ...externalLinks,
                {
                  key: 'npm',
                  href: 'https://www.npmjs.com/package/@robota-sdk/agent-framework',
                },
              ].map(({ key, href }) => (
                <li key={key}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[44px] items-center text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                  >
                    {t(`footer.links.${key}` as Parameters<typeof t>[0])}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              {t('footer.company')}
            </p>
            <ul className="mt-3 space-y-2">
              <li>
                <InternalLink
                  href={`/${locale}/enterprise`}
                  className="inline-flex min-h-[44px] items-center text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                >
                  {t('footer.links.enterprise')}
                </InternalLink>
              </li>
              {[
                ...(productPublicConfig.identity.repositoryUrl
                  ? [
                {
                  key: 'githubDiscussions',
                  href: `${productPublicConfig.identity.repositoryUrl}/discussions`,
                },
                {
                  key: 'issues',
                  href: `${productPublicConfig.identity.repositoryUrl}/issues`,
                },
                    ]
                  : []),
              ].map(({ key, href }) => (
                <li key={key}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[44px] items-center text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                  >
                    {t(`footer.links.${key}` as Parameters<typeof t>[0])}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-8 border-t border-[var(--border)] pt-6 flex flex-col sm:flex-row justify-between gap-3">
          <p className="text-xs text-[var(--muted-foreground)]">{t('footer.copyright')}</p>
        </div>
      </div>
    </footer>
  );
}

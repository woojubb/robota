'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

export function Footer() {
  const t = useTranslations('common');
  const locale = useLocale();

  return (
    <footer className="border-t border-[var(--border)] bg-[var(--background)]">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <p className="text-lg font-bold text-[var(--foreground)]">robota</p>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">{t('footer.tagline')}</p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              {t('footer.product')}
            </p>
            <ul className="mt-3 space-y-2">
              <li>
                <Link
                  prefetch={false}
                  href={`/${locale}/compare`}
                  className="inline-flex min-h-[44px] items-center text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                >
                  {t('footer.links.whyRobota')}
                </Link>
              </li>
              <li>
                <Link
                  prefetch={false}
                  href={`/${locale}/showcase`}
                  className="inline-flex min-h-[44px] items-center text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                >
                  {t('footer.links.showcase')}
                </Link>
              </li>
              <li>
                <Link
                  prefetch={false}
                  href={`/${locale}/roadmap`}
                  className="inline-flex min-h-[44px] items-center text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                >
                  {t('footer.links.roadmap')}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              {t('footer.developers')}
            </p>
            <ul className="mt-3 space-y-2">
              {[
                { key: 'documentation', href: 'https://docs.robota.io' },
                { key: 'gettingStarted', href: 'https://docs.robota.io/getting-started/' },
                { key: 'github', href: 'https://github.com/woojubb/robota' },
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
                <Link
                  prefetch={false}
                  href={`/${locale}/enterprise`}
                  className="inline-flex min-h-[44px] items-center text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                >
                  {t('footer.links.enterprise')}
                </Link>
              </li>
              {[
                {
                  key: 'githubDiscussions',
                  href: 'https://github.com/woojubb/robota/discussions',
                },
                { key: 'issues', href: 'https://github.com/woojubb/robota/issues' },
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
          {/* Playground temporarily hidden until the hosted playground (play.robota.io) ships. Restore: see backlog WWW-PLAYGROUND-RESTORE. */}
          {/* <a
            href="https://play.robota.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            {t('footer.links.playground')} ↗
          </a> */}
        </div>
      </div>
    </footer>
  );
}

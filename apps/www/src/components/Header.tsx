'use client';

import { InternalLink } from './ui';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { productPublicConfig } from '@/lib/product-config.generated';

export function Header() {
  const t = useTranslations('common');
  const locale = useLocale();
  const docsUrl = productPublicConfig.identity.docsUrl?.replace(/\/+$/u, '');
  const pathname = usePathname();
  const router = useRouter();

  function switchLocale(next: string) {
    // Replace leading /{locale} with /{next}
    const segments = pathname.split('/');
    segments[1] = next;
    router.push(segments.join('/') || '/');
  }

  const otherLocale = locale === 'en' ? 'ko' : 'en';

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--background)]/90 backdrop-blur-sm">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
          <InternalLink href={`/${locale}`} className="flex items-center gap-2">
            <span className="text-lg font-bold text-[var(--foreground)]">
              {productPublicConfig.identity.displayName}
            </span>
            <span className="rounded-full bg-[var(--accent-dim)] px-2 py-0.5 text-xs font-medium text-[var(--accent)]">
              beta
            </span>
          </InternalLink>

          <nav className="hidden items-center gap-1 md:flex">
            <InternalLink
              href={`/${locale}/compare`}
              className="inline-flex min-h-[44px] items-center rounded-md px-3 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              {t('nav.whyProduct')}
            </InternalLink>
            <InternalLink
              href={`/${locale}/showcase`}
              className="inline-flex min-h-[44px] items-center rounded-md px-3 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              {t('nav.showcase')}
            </InternalLink>
            <InternalLink
              href={`/${locale}/roadmap`}
              className="inline-flex min-h-[44px] items-center rounded-md px-3 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              {t('nav.roadmap')}
            </InternalLink>
          </nav>

          <div className="flex items-center gap-2">
            <button
              onClick={() => switchLocale(otherLocale)}
              className="inline-flex min-h-[44px] items-center rounded-md border border-[var(--border)] px-2.5 text-xs font-semibold text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
              aria-label={`Switch to ${otherLocale}`}
            >
              {t(`lang.${otherLocale}`)}
            </button>
            {docsUrl && (
              <a
                href={`${docsUrl}/${locale}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center rounded-md px-3 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
              >
                {t('nav.docs')} ↗
              </a>
            )}
            {productPublicConfig.identity.repositoryUrl && (
              <a
                href={productPublicConfig.identity.repositoryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center rounded-md bg-[var(--primary)] px-3 text-sm font-medium text-[var(--primary-foreground)] hover:bg-[var(--accent-hover)] transition-colors"
              >
                {t('nav.github')}
              </a>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

'use client';

import { InternalLink } from './ui';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';

export function Header() {
  const t = useTranslations('common');
  const locale = useLocale();
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
            <span className="text-lg font-bold text-[var(--foreground)]">robota</span>
            <span className="rounded-full bg-[var(--accent-dim)] px-2 py-0.5 text-xs font-medium text-[var(--accent)]">
              beta
            </span>
          </InternalLink>

          <nav className="hidden items-center gap-1 md:flex">
            <InternalLink
              href={`/${locale}/compare`}
              className="tap-target rounded-md px-3 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              {t('nav.whyRobota')}
            </InternalLink>
            <InternalLink
              href={`/${locale}/showcase`}
              className="tap-target rounded-md px-3 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              {t('nav.showcase')}
            </InternalLink>
            <InternalLink
              href={`/${locale}/roadmap`}
              className="tap-target rounded-md px-3 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              {t('nav.roadmap')}
            </InternalLink>
          </nav>

          <div className="flex items-center gap-2">
            <button
              onClick={() => switchLocale(otherLocale)}
              className="tap-target rounded-md border border-[var(--border)] px-2.5 text-xs font-semibold text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
              aria-label={`Switch to ${otherLocale}`}
            >
              {t(`lang.${otherLocale}`)}
            </button>
            <a
              href="https://docs.robota.io"
              target="_blank"
              rel="noopener noreferrer"
              className="tap-target rounded-md px-3 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              {t('nav.docs')} ↗
            </a>
            <a
              href="https://github.com/woojubb/robota"
              target="_blank"
              rel="noopener noreferrer"
              className="tap-target rounded-md bg-[var(--primary)] px-3 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 transition-opacity"
            >
              {t('nav.github')}
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}

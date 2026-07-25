'use client';

import { InternalLink } from './InternalLink';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { ThemeToggle } from './ThemeToggle';
import { SearchButton } from './SearchButton';

const NAV_LINKS: { labelKey: string; href: string; external?: boolean }[] = [
  { labelKey: 'Getting Started', href: 'getting-started' },
  { labelKey: 'Guide', href: 'guide' },
  { labelKey: 'Examples', href: 'examples' },
  { labelKey: 'Packages', href: 'packages' },
  { labelKey: 'Changelog', href: 'changelog' },
  { labelKey: 'Development', href: 'development' },
  // WEB-019: Playground is temporarily hidden until the hosted playground ships (the
  // subdomain is not yet deployed). Restore alongside WEB-005 using the canonical
  // `play.robota.io` subdomain (matching the marketing site), not `playground.robota.io`.
  // { labelKey: 'Playground', href: 'https://play.robota.io', external: true },
];

const NAV_ITEM_CLASSES =
  'flex min-h-11 items-center whitespace-nowrap rounded px-2.5 text-[0.8rem] [font-family:var(--font-body)] tracking-[0.01em] no-underline transition-colors';

export function Header() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  function switchLocale(next: string) {
    const segments = pathname.split('/');
    segments[1] = next;
    router.push(segments.join('/') || '/');
  }

  const otherLocale = locale === 'en' ? 'ko' : 'en';

  return (
    <header className="sticky top-0 z-50 flex h-[var(--header-height)] items-center gap-3 border-b border-border bg-[rgba(5,5,8,0.92)] px-4 backdrop-blur-xl md:gap-5 md:px-6">
      {/* Top gradient line */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent_0%,var(--primary)_30%,var(--secondary)_70%,transparent_100%)] opacity-60"
      />

      {/* Logo */}
      <InternalLink
        href={`/${locale}`}
        className="flex min-h-11 shrink-0 items-center gap-1.5 no-underline"
      >
        <span className="[font-family:var(--font-display)] text-base font-bold tracking-[-0.02em] text-primary">
          robota
        </span>
        <span className="rounded border border-[var(--border-strong)] bg-muted px-1.5 py-0.5 [font-family:var(--font-code)] text-xs font-normal tracking-[0.02em] text-muted-foreground">
          docs
        </span>
      </InternalLink>

      {/* Center nav — hidden on mobile (the hamburger + sidebar covers navigation there) */}
      <nav
        aria-label="Main navigation"
        className="hidden min-w-0 flex-1 items-center gap-px overflow-x-auto md:flex"
      >
        {NAV_LINKS.map((link) => {
          if (link.external) {
            return (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`${NAV_ITEM_CLASSES} text-muted-foreground hover:text-[var(--foreground-hi)]`}
              >
                {link.labelKey}
                <span aria-hidden="true" className="ml-1 text-[0.65rem] opacity-50">
                  ↗
                </span>
              </a>
            );
          }
          const href = `/${locale}/${link.href}`;
          const isActive = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <InternalLink
              key={link.href}
              href={href}
              aria-current={isActive ? 'page' : undefined}
              className={`${NAV_ITEM_CLASSES} ${
                isActive
                  ? 'text-[var(--foreground-hi)]'
                  : 'text-muted-foreground hover:text-[var(--foreground-hi)]'
              }`}
            >
              {link.labelKey}
            </InternalLink>
          );
        })}
      </nav>

      {/* Right actions */}
      <div className="ml-auto flex shrink-0 items-center gap-1.5 md:ml-0 md:gap-2">
        <SearchButton />
        <ThemeToggle />

        {/* Language toggle */}
        <button
          onClick={() => switchLocale(otherLocale)}
          aria-label={
            otherLocale === 'ko' ? 'Switch language to 한국어' : 'Switch language to English'
          }
          className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded border border-[var(--border-strong)] bg-transparent [font-family:var(--font-code)] text-[0.65rem] font-semibold tracking-[0.04em] text-muted-foreground transition-colors hover:text-[var(--foreground-hi)]"
        >
          {otherLocale.toUpperCase()}
        </button>

        {/* GitHub */}
        <a
          href="https://github.com/woojubb/robota"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub repository"
          className="flex min-h-11 min-w-11 items-center justify-center rounded border border-[var(--border-strong)] text-muted-foreground no-underline transition-colors hover:text-[var(--foreground-hi)]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
          </svg>
        </a>

        {/* robota.io back link — wide screens only, to keep the bar uncrowded */}
        <a
          href="https://robota.io"
          className="hidden min-h-11 items-center whitespace-nowrap rounded border border-[var(--border-strong)] px-2.5 [font-family:var(--font-code)] text-xs tracking-[0.01em] text-muted-foreground no-underline transition-colors hover:text-[var(--foreground-hi)] xl:inline-flex"
        >
          ← robota.io
        </a>
      </div>
    </header>
  );
}

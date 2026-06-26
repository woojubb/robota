'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { ThemeToggle } from './ThemeToggle';
import { SearchButton } from './SearchButton';

const NAV_LINKS = [
  { labelKey: 'Getting Started', href: 'getting-started' },
  { labelKey: 'Guide', href: 'guide' },
  { labelKey: 'Examples', href: 'examples' },
  { labelKey: 'Packages', href: 'packages' },
  { labelKey: 'Changelog', href: 'changelog' },
  { labelKey: 'Development', href: 'development' },
  { labelKey: 'Playground', href: 'https://playground.robota.io', external: true },
];

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
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        height: 'var(--header-height)',
        background: 'rgba(5,5,8,0.92)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 1.5rem',
        gap: '1.5rem',
      }}
    >
      {/* Top gradient line */}
      <div className="docs-header-line" />

      {/* Logo */}
      <Link
        prefetch={false}
        href={`/${locale}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.375rem',
          textDecoration: 'none',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1rem',
            color: 'var(--primary)',
            letterSpacing: '-0.02em',
          }}
        >
          robota
        </span>
        <span
          style={{
            fontFamily: 'var(--font-code)',
            fontWeight: 400,
            fontSize: '0.75rem',
            color: 'var(--muted-foreground)',
            background: 'var(--muted)',
            border: '1px solid var(--border-strong)',
            borderRadius: '0.25rem',
            padding: '0.1rem 0.4rem',
            letterSpacing: '0.02em',
          }}
        >
          docs
        </span>
      </Link>

      {/* Center nav */}
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.0625rem',
          flex: 1,
          overflowX: 'auto',
        }}
        aria-label="Main navigation"
      >
        {NAV_LINKS.map((link) =>
          link.external ? (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: '0.25rem 0.625rem',
                fontSize: '0.8rem',
                fontFamily: 'var(--font-body)',
                color: 'var(--muted-foreground)',
                textDecoration: 'none',
                borderRadius: '0.25rem',
                whiteSpace: 'nowrap',
                letterSpacing: '0.01em',
              }}
              className="nav-link"
            >
              {link.labelKey}
              <span style={{ fontSize: '0.65rem', marginLeft: '0.2rem', opacity: 0.5 }}>↗</span>
            </a>
          ) : (
            <Link
              prefetch={false}
              key={link.href}
              href={`/${locale}/${link.href}`}
              style={{
                padding: '0.25rem 0.625rem',
                fontSize: '0.8rem',
                fontFamily: 'var(--font-body)',
                color: 'var(--muted-foreground)',
                textDecoration: 'none',
                borderRadius: '0.25rem',
                whiteSpace: 'nowrap',
                letterSpacing: '0.01em',
              }}
              className="nav-link"
            >
              {link.labelKey}
            </Link>
          ),
        )}
      </nav>

      {/* Right actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
        <SearchButton />
        <ThemeToggle />

        {/* Language toggle */}
        <button
          onClick={() => switchLocale(otherLocale)}
          aria-label={`Switch to ${otherLocale}`}
          style={{
            width: 30,
            height: 30,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-code)',
            fontSize: '0.65rem',
            fontWeight: 600,
            color: 'var(--muted-foreground)',
            border: '1px solid var(--border-strong)',
            borderRadius: '0.25rem',
            background: 'transparent',
            cursor: 'pointer',
            letterSpacing: '0.04em',
            transition: 'color 0.15s, border-color 0.15s',
          }}
          className="nav-link"
        >
          {otherLocale.toUpperCase()}
        </button>

        {/* GitHub */}
        <a
          href="https://github.com/woojubb/robota"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub repository"
          style={{
            width: 30,
            height: 30,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--muted-foreground)',
            border: '1px solid var(--border-strong)',
            borderRadius: '0.25rem',
            textDecoration: 'none',
            transition: 'color 0.15s, border-color 0.15s',
          }}
          className="nav-link"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
          </svg>
        </a>

        {/* robota.io back link */}
        <a
          href="https://robota.io"
          style={{
            padding: '0.2rem 0.6rem',
            fontSize: '0.75rem',
            fontFamily: 'var(--font-code)',
            color: 'var(--muted-foreground)',
            border: '1px solid var(--border-strong)',
            borderRadius: '0.25rem',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            transition: 'color 0.15s, border-color 0.15s',
            letterSpacing: '0.01em',
          }}
          className="nav-link"
        >
          ← robota.io
        </a>
      </div>
    </header>
  );
}

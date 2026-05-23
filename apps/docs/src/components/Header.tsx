import Link from 'next/link';
import { ThemeToggle } from './ThemeToggle';
import { SearchButton } from './SearchButton';

const NAV_LINKS = [
  { label: 'Getting Started', href: '/getting-started' },
  { label: 'Guide', href: '/guide' },
  { label: 'Examples', href: '/examples' },
  { label: 'Packages', href: '/packages' },
  { label: 'Changelog', href: '/changelog' },
  { label: 'Development', href: '/development' },
  { label: 'Playground', href: 'https://playground.robota.io', external: true },
];

export function Header() {
  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        height: 'var(--header-height)',
        background: 'rgba(10,10,15,0.85)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 1.25rem',
        gap: '1.5rem',
      }}
    >
      {/* Logo */}
      <Link
        href="/"
        style={{
          fontWeight: 700,
          fontSize: '1rem',
          color: 'var(--foreground)',
          textDecoration: 'none',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        <span style={{ color: 'var(--primary)' }}>robota</span>
        <span style={{ color: 'var(--muted-foreground)', fontWeight: 400 }}> docs</span>
      </Link>

      {/* Center nav */}
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.125rem',
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
                fontSize: '0.85rem',
                color: 'var(--muted-foreground)',
                textDecoration: 'none',
                borderRadius: '0.375rem',
                whiteSpace: 'nowrap',
                transition: 'color 0.15s, background 0.15s',
              }}
              className="nav-link"
            >
              {link.label}
              <span style={{ fontSize: '0.7rem', marginLeft: '0.2rem', opacity: 0.6 }}>↗</span>
            </a>
          ) : (
            <Link
              key={link.href}
              href={link.href}
              style={{
                padding: '0.25rem 0.625rem',
                fontSize: '0.85rem',
                color: 'var(--muted-foreground)',
                textDecoration: 'none',
                borderRadius: '0.375rem',
                whiteSpace: 'nowrap',
                transition: 'color 0.15s, background 0.15s',
              }}
              className="nav-link"
            >
              {link.label}
            </Link>
          ),
        )}
      </nav>

      {/* Right actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
        <SearchButton />
        <ThemeToggle />

        {/* GitHub */}
        <a
          href="https://github.com/woojubb/robota"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub repository"
          style={{
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--muted-foreground)',
            border: '1px solid var(--border)',
            borderRadius: '0.375rem',
            textDecoration: 'none',
            transition: 'color 0.15s, border-color 0.15s',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
          </svg>
        </a>

        {/* robota.io back link */}
        <a
          href="https://robota.io"
          style={{
            padding: '0.25rem 0.625rem',
            fontSize: '0.8rem',
            color: 'var(--muted-foreground)',
            border: '1px solid var(--border)',
            borderRadius: '0.375rem',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            transition: 'color 0.15s, border-color 0.15s',
          }}
        >
          ← robota.io
        </a>
      </div>
    </header>
  );
}

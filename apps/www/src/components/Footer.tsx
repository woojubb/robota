import Link from 'next/link';

export function Footer() {
  return (
    <footer className="border-t border-[var(--border)] bg-[var(--background)]">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <p className="text-lg font-bold text-[var(--foreground)]">robota</p>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              Open-source AI agent SDK and CLI. MIT licensed.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Product
            </p>
            <ul className="mt-3 space-y-2">
              {[
                { label: 'Why Robota', href: '/compare' },
                { label: 'Cost Calculator', href: '/tools/cost-calculator' },
                { label: 'Showcase', href: '/showcase' },
                { label: 'Roadmap', href: '/roadmap' },
              ].map(({ label, href }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Developers
            </p>
            <ul className="mt-3 space-y-2">
              {[
                { label: 'Documentation', href: 'https://docs.robota.io' },
                { label: 'Getting Started', href: 'https://docs.robota.io/getting-started/' },
                { label: 'GitHub', href: 'https://github.com/woojubb/robota' },
                { label: 'npm', href: 'https://www.npmjs.com/package/@robota-sdk/agent-framework' },
              ].map(({ label, href }) => (
                <li key={href}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Company
            </p>
            <ul className="mt-3 space-y-2">
              {[
                { label: 'Enterprise', href: '/enterprise' },
                {
                  label: 'GitHub Discussions',
                  href: 'https://github.com/woojubb/robota/discussions',
                },
                { label: 'Issues', href: 'https://github.com/woojubb/robota/issues' },
              ].map(({ label, href }) => (
                <li key={href}>
                  {href.startsWith('http') ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                    >
                      {label}
                    </a>
                  ) : (
                    <Link
                      href={href}
                      className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                    >
                      {label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-8 border-t border-[var(--border)] pt-6 flex flex-col sm:flex-row justify-between gap-3">
          <p className="text-xs text-[var(--muted-foreground)]">© 2026 Robota. MIT License.</p>
          <a
            href="https://play.robota.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            Playground ↗
          </a>
        </div>
      </div>
    </footer>
  );
}

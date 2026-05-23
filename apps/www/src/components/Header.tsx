import Link from 'next/link';

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--background)]/90 backdrop-blur-sm">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-lg font-bold text-[var(--foreground)]">robota</span>
            <span className="rounded-full bg-[var(--accent-dim)] px-2 py-0.5 text-xs font-medium text-[var(--accent)]">
              beta
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            <Link
              href="/compare"
              className="rounded-md px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              Why Robota
            </Link>
            {/* Cost Calculator — 요금 페이지 미준비, 준비 후 주석 해제
            <Link
              href="/tools/cost-calculator"
              className="rounded-md px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              Cost Calculator
            </Link>
            */}
            <Link
              href="/showcase"
              className="rounded-md px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              Showcase
            </Link>
            <Link
              href="/roadmap"
              className="rounded-md px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              Roadmap
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <a
              href="https://docs.robota.io"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            >
              Docs ↗
            </a>
            <a
              href="https://github.com/woojubb/robota"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 transition-opacity"
            >
              GitHub
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}

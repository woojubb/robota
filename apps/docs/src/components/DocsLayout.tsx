'use client';

import { useState } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { TableOfContents } from './TableOfContents';
import type { SidebarItem } from '@/lib/sidebar';
import type { TocEntry } from '@/lib/toc';

interface DocsLayoutProps {
  sidebar: SidebarItem[];
  toc: TocEntry[];
  children: React.ReactNode;
}

export function DocsLayout({ sidebar, toc, children }: DocsLayoutProps) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col">
      {/* Skip link — first focusable element, jumps keyboard users past header + sidebar */}
      <a
        href="#docs-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded focus:bg-primary focus:px-4 focus:py-2 focus:font-semibold focus:text-[var(--primary-foreground)] focus:no-underline"
      >
        Skip to content
      </a>

      <Header />

      <div className="relative flex flex-1">
        {/* Mobile hamburger — only visible on small screens */}
        <button
          onClick={() => setMobileSidebarOpen(true)}
          aria-label="Open navigation"
          className="fixed bottom-5 right-5 z-50 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border-0 bg-primary text-[var(--primary-foreground)] shadow-[0_4px_16px_color-mix(in_srgb,var(--accent)_35%,transparent)] md:hidden"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        {/* Left sidebar */}
        <Sidebar
          items={sidebar}
          mobileOpen={mobileSidebarOpen}
          onClose={() => setMobileSidebarOpen(false)}
        />

        {/* Main content area — offset by sidebar width on desktop */}
        <main className="flex min-w-0 flex-1 justify-center px-4 py-6 md:ml-[var(--sidebar-width)] md:px-8 md:py-10">
          {/* Article content */}
          <article
            id="docs-content"
            tabIndex={-1}
            className="prose min-w-0 max-w-[var(--content-max-width)] flex-1 outline-none"
          >
            {children}
          </article>

          {/* Right ToC — only shown when there are entries, and only on wide screens */}
          {toc.length > 0 && (
            <div className="ml-12 hidden shrink-0 lg:block">
              <TableOfContents entries={toc} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

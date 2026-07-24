'use client';

import { useEffect } from 'react';

export function SearchButton() {
  // Load pagefind UI after mount (only available post-build)
  useEffect(() => {
    async function loadPagefind() {
      if (typeof window === 'undefined') return;
      // Pagefind is a post-build artifact — only available in production builds
      try {
        // @ts-expect-error pagefind is injected at build time
        const pagefind = await import(/* webpackIgnore: true */ '/pagefind/pagefind.js');
        await pagefind.init();
      } catch {
        // Not available in dev mode — silently ignore
      }
    }
    loadPagefind();
  }, []);

  function openSearch() {
    // Trigger pagefind UI if available
    const el = document.getElementById('pagefind-search-input');
    if (el) {
      el.focus();
    } else {
      // Fallback: open pagefind modal via keyboard shortcut simulation
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
      );
    }
  }

  return (
    <button
      onClick={openSearch}
      aria-label="Search documentation"
      title="Search (⌘K)"
      className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-muted px-2 text-[0.8rem] text-muted-foreground transition-colors hover:text-[var(--foreground-hi)] lg:justify-start lg:px-3"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      {/* Label + shortcut hint collapse to icon-only below lg to keep the header uncrowded */}
      <span className="hidden lg:inline">Search</span>
      <kbd className="ml-1 hidden rounded-sm border border-border bg-white/5 px-1 py-0.5 [font-family:inherit] text-[0.7rem] leading-normal lg:inline-block">
        ⌘K
      </kbd>
    </button>
  );
}

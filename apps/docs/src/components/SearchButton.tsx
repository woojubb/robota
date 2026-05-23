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
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.4rem',
        padding: '0.25rem 0.75rem',
        background: 'var(--muted)',
        border: '1px solid var(--border)',
        borderRadius: '0.375rem',
        color: 'var(--muted-foreground)',
        fontSize: '0.8rem',
        cursor: 'pointer',
        transition: 'border-color 0.15s, color 0.15s',
        whiteSpace: 'nowrap',
      }}
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
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <span>Search</span>
      <kbd
        style={{
          marginLeft: '0.25rem',
          padding: '0.1rem 0.3rem',
          fontSize: '0.7rem',
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid var(--border)',
          borderRadius: '0.2rem',
          fontFamily: 'inherit',
          lineHeight: 1.5,
        }}
      >
        ⌘K
      </kbd>
    </button>
  );
}

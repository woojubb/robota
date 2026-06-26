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
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header />

      <div
        style={{
          display: 'flex',
          flex: 1,
          position: 'relative',
        }}
      >
        {/* Mobile hamburger — only visible on small screens via CSS class */}
        <button
          className="mobile-menu-btn"
          onClick={() => setMobileSidebarOpen(true)}
          aria-label="Open navigation"
          style={{
            position: 'fixed',
            bottom: '1.25rem',
            right: '1.25rem',
            zIndex: 50,
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: 'var(--primary)',
            color: 'var(--primary-foreground)',
            border: 'none',
            cursor: 'pointer',
            display: 'none',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 16px rgba(45,212,167,0.35)',
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
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
        <main
          style={{
            flex: 1,
            marginLeft: 'var(--sidebar-width)',
            minWidth: 0,
            display: 'flex',
            justifyContent: 'center',
            padding: '2.5rem 2rem',
          }}
          className="docs-main"
        >
          {/* Article content */}
          <article
            className="prose"
            style={{
              flex: 1,
              maxWidth: 'var(--content-max-width)',
              minWidth: 0,
            }}
          >
            {children}
          </article>

          {/* Right ToC — only shown when there are entries */}
          {toc.length > 0 && (
            <div style={{ marginLeft: '3rem', flexShrink: 0 }} className="docs-toc">
              <TableOfContents entries={toc} />
            </div>
          )}
        </main>
      </div>

      {/* Responsive overrides injected as a style tag */}
      <style>{`
        @media (max-width: 1024px) {
          .docs-toc { display: none !important; }
        }
        @media (max-width: 768px) {
          .docs-sidebar {
            transform: translateX(-100%);
            transition: transform 0.25s ease;
          }
          .docs-sidebar[style*="translateX(0)"] {
            transform: translateX(0) !important;
          }
          .docs-main {
            margin-left: 0 !important;
            padding: 1.5rem 1rem !important;
          }
          .mobile-menu-btn {
            display: flex !important;
          }
          header nav {
            display: none !important;
          }
        }
        .nav-link:hover {
          color: var(--foreground) !important;
          background: var(--muted) !important;
        }
      `}</style>
    </div>
  );
}

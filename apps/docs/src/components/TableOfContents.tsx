'use client';

import { useEffect, useRef, useState } from 'react';
import type { TocEntry } from '@/lib/toc';

interface TableOfContentsProps {
  entries: TocEntry[];
}

export function TableOfContents({ entries }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>('');
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (entries.length === 0) return;

    const headingIds = entries.map((e) => e.id);

    observerRef.current = new IntersectionObserver(
      (observed) => {
        // Find the topmost intersecting heading
        const visible = observed
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => {
            const aTop = a.boundingClientRect.top;
            const bTop = b.boundingClientRect.top;
            return aTop - bTop;
          });

        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        rootMargin: '-60px 0px -70% 0px',
        threshold: 0,
      },
    );

    for (const id of headingIds) {
      const el = document.getElementById(id);
      if (el) observerRef.current.observe(el);
    }

    return () => observerRef.current?.disconnect();
  }, [entries]);

  if (entries.length === 0) return null;

  return (
    <nav
      aria-label="Table of contents"
      style={{
        position: 'sticky',
        top: 'calc(var(--header-height) + 1.5rem)',
        width: 'var(--toc-width)',
        flexShrink: 0,
        alignSelf: 'flex-start',
        maxHeight: 'calc(100vh - var(--header-height) - 3rem)',
        overflowY: 'auto',
        padding: '0 0.5rem',
      }}
    >
      <p
        style={{
          fontSize: '0.7rem',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--muted-foreground)',
          marginBottom: '0.75rem',
          marginTop: 0,
        }}
      >
        On this page
      </p>
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.125rem',
        }}
      >
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              style={{
                display: 'block',
                fontSize: '0.8rem',
                lineHeight: 1.5,
                paddingLeft: entry.level === 3 ? '0.875rem' : '0',
                paddingTop: '0.2rem',
                paddingBottom: '0.2rem',
                color: activeId === entry.id ? 'var(--primary)' : 'var(--muted-foreground)',
                textDecoration: 'none',
                borderLeft:
                  entry.level === 3
                    ? `2px solid ${activeId === entry.id ? 'var(--primary)' : 'var(--border)'}`
                    : undefined,
                transition: 'color 0.15s, border-color 0.15s',
                wordBreak: 'break-word',
              }}
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

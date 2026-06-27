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
        const visible = observed
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: '-60px 0px -70% 0px', threshold: 0 },
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
      }}
    >
      <p
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '0.65rem',
          fontWeight: 600,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--muted-foreground)',
          marginBottom: '0.875rem',
          marginTop: 0,
        }}
      >
        On this page
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {entries.map((entry) => {
          const isActive = activeId === entry.id;
          return (
            <li key={entry.id} style={{ marginBottom: '0.1rem' }}>
              <a
                href={`#${entry.id}`}
                aria-current={isActive ? 'location' : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.5rem',
                  fontSize: '0.775rem',
                  fontFamily: 'var(--font-body)',
                  lineHeight: 1.55,
                  paddingLeft: entry.level === 3 ? '1rem' : '0',
                  paddingTop: '0.225rem',
                  paddingBottom: '0.225rem',
                  color: isActive ? 'var(--primary)' : 'var(--muted-foreground)',
                  textDecoration: 'none',
                  transition: 'color 0.15s',
                  wordBreak: 'break-word',
                  position: 'relative',
                }}
              >
                {/* Active indicator dot (decorative; state is conveyed via aria-current) */}
                {isActive && (
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: entry.level === 3 ? '0.25rem' : '-0.75rem',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: 4,
                      height: 4,
                      borderRadius: '50%',
                      background: 'var(--primary)',
                      boxShadow: '0 0 6px var(--primary)',
                      flexShrink: 0,
                    }}
                  />
                )}
                {entry.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

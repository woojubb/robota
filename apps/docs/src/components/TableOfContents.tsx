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
      className="sticky top-[calc(var(--header-height)_+_1.5rem)] max-h-[calc(100vh_-_var(--header-height)_-_3rem)] w-[var(--toc-width)] shrink-0 self-start overflow-y-auto"
    >
      <p className="mb-3.5 mt-0 [font-family:var(--font-display)] text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        On this page
      </p>
      <ul className="m-0 list-none p-0">
        {entries.map((entry) => {
          const isActive = activeId === entry.id;
          return (
            <li key={entry.id} className="mb-[0.1rem]">
              <a
                href={`#${entry.id}`}
                aria-current={isActive ? 'location' : undefined}
                className={`relative flex items-start gap-2 py-[0.225rem] [font-family:var(--font-body)] text-[0.775rem] leading-[1.55] [word-break:break-word] no-underline transition-colors duration-150 ${
                  entry.level === 3 ? 'pl-4' : 'pl-0'
                } ${isActive ? 'text-primary' : 'text-muted-foreground'}`}
              >
                {/* Active indicator dot (decorative; state is conveyed via aria-current) */}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className={`absolute top-1/2 h-1 w-1 shrink-0 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_6px_var(--primary)] ${
                      entry.level === 3 ? 'left-1' : '-left-3'
                    }`}
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

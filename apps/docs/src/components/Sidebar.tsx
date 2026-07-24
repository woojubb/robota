'use client';

import { InternalLink } from './InternalLink';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import type { SidebarItem } from '@/lib/sidebar';

interface SidebarProps {
  items: SidebarItem[];
  mobileOpen: boolean;
  onClose: () => void;
}

interface SectionProps {
  item: SidebarItem;
  depth: number;
}

/* Rows keep the compact desktop density but grow to a 44px touch target on
 * coarse-pointer (touch) devices. */
const ROW_MIN_HEIGHT = 'min-h-9 pointer-coarse:min-h-11';

/* The site exports with `trailingSlash: true`, so `usePathname()` yields `/en/guide/`
 * while sidebar hrefs are `/en/guide` — compare with the trailing slash stripped. */
function normalizePath(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

function SidebarSection({ item, depth }: SectionProps) {
  const pathname = normalizePath(usePathname());
  const isActive = pathname === normalizePath(item.href);
  const isChildActive = item.children?.some(
    (child) =>
      pathname === normalizePath(child.href) ||
      pathname.startsWith(normalizePath(child.href) + '/'),
  );
  // Open when this section's own page or any child page is active.
  const [open, setOpen] = useState((isChildActive ?? true) || isActive);

  const hasChildren = item.children && item.children.length > 0;

  if (depth === 0 && hasChildren) {
    return (
      <div className="mb-0.5">
        {/* Section header — clickable toggle */}
        <button
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={`${ROW_MIN_HEIGHT} mt-4 flex w-full cursor-pointer items-center justify-between rounded border-0 bg-transparent px-3 py-1 text-left [font-family:var(--font-display)] text-[0.7rem] font-semibold uppercase tracking-[0.1em] transition-colors ${
            isChildActive || isActive ? 'text-primary' : 'text-muted-foreground'
          }`}
        >
          <InternalLink
            href={item.href}
            onClick={(e) => e.stopPropagation()}
            aria-current={isActive ? 'page' : undefined}
            className="flex-1 text-inherit no-underline"
          >
            {item.title}
          </InternalLink>
          <span
            aria-hidden="true"
            className={`shrink-0 text-[0.6rem] opacity-50 transition-transform ${open ? 'rotate-90' : ''}`}
          >
            ▶
          </span>
        </button>

        {open && (
          <div className="mt-0.5">
            {item.children!.map((child) => (
              <SidebarSection key={child.href} item={child} depth={1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (depth === 0 && !hasChildren) {
    return (
      <InternalLink
        href={item.href}
        aria-current={isActive ? 'page' : undefined}
        className={`${ROW_MIN_HEIGHT} mt-4 flex items-center rounded border-l-2 px-3 py-1 [font-family:var(--font-display)] text-[0.7rem] font-semibold uppercase tracking-[0.1em] no-underline transition-colors ${
          isActive
            ? 'border-primary bg-[var(--primary-dim)] text-primary'
            : 'border-transparent text-muted-foreground hover:bg-white/[0.04] hover:text-[var(--foreground-hi)]'
        }`}
      >
        {item.title}
      </InternalLink>
    );
  }

  /* depth >= 1 — leaf items */
  const hasNestedChildren = hasChildren;
  if (hasNestedChildren) {
    return (
      <div>
        <button
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={`${ROW_MIN_HEIGHT} flex w-full cursor-pointer items-center justify-between rounded-r border-0 border-l-2 py-1 pl-5 pr-3 text-left [font-family:var(--font-body)] text-[0.825rem] transition-colors ${
            isActive
              ? 'border-primary bg-[var(--primary-dim)] font-medium'
              : 'border-transparent bg-transparent font-normal'
          } ${
            isActive || isChildActive
              ? 'text-[var(--foreground-hi)]'
              : 'text-muted-foreground hover:bg-white/[0.04] hover:text-[var(--foreground-hi)]'
          }`}
        >
          <InternalLink
            href={item.href}
            onClick={(e) => e.stopPropagation()}
            aria-current={isActive ? 'page' : undefined}
            className="flex-1 text-inherit no-underline"
          >
            {item.title}
          </InternalLink>
          <span
            aria-hidden="true"
            className={`shrink-0 text-[0.6rem] opacity-40 transition-transform ${open ? 'rotate-90' : ''}`}
          >
            ▶
          </span>
        </button>
        {open && (
          <div className="ml-2">
            {item.children!.map((child) => (
              <SidebarSection key={child.href} item={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <InternalLink
      href={item.href}
      aria-current={isActive ? 'page' : undefined}
      className={`${ROW_MIN_HEIGHT} flex items-center rounded-r border-l-2 py-1 pl-5 pr-3 [font-family:var(--font-body)] text-[0.825rem] no-underline transition-colors ${
        isActive
          ? 'border-primary bg-[var(--primary-dim)] font-medium text-[var(--foreground-hi)]'
          : 'border-transparent font-normal text-muted-foreground hover:bg-white/[0.04] hover:text-[var(--foreground-hi)]'
      }`}
    >
      {item.title}
    </InternalLink>
  );
}

export function Sidebar({ items, mobileOpen, onClose }: SidebarProps) {
  return (
    <>
      {mobileOpen && (
        <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-[39] bg-black/60" />
      )}

      <aside
        className={`fixed bottom-0 left-0 top-[var(--header-height)] z-40 flex w-[var(--sidebar-width)] flex-col overflow-y-auto overflow-x-hidden border-r border-border bg-background px-2 pb-8 pt-2 transition-transform duration-[250ms] ease-in-out md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <nav aria-label="Documentation">
          {items.map((item) => (
            <SidebarSection key={item.href} item={item} depth={0} />
          ))}
        </nav>
      </aside>
    </>
  );
}

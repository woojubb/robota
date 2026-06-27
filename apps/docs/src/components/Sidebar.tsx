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

function SidebarSection({ item, depth }: SectionProps) {
  const pathname = usePathname();
  const isActive = pathname === item.href;
  const isChildActive = item.children?.some(
    (child) => pathname === child.href || pathname.startsWith(child.href + '/'),
  );
  const [open, setOpen] = useState(isChildActive ?? true);

  const hasChildren = item.children && item.children.length > 0;

  if (depth === 0 && hasChildren) {
    return (
      <div style={{ marginBottom: '0.125rem' }}>
        {/* Section header — clickable toggle */}
        <button
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            minHeight: '2.25rem',
            padding: '0.3rem 0.75rem',
            background: 'transparent',
            border: 'none',
            borderRadius: '0.25rem',
            color: isChildActive || isActive ? 'var(--primary)' : 'var(--muted-foreground)',
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: '0.7rem',
            cursor: 'pointer',
            textAlign: 'left',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            transition: 'color 0.15s',
            marginTop: '1rem',
          }}
        >
          <InternalLink
            href={item.href}
            onClick={(e) => e.stopPropagation()}
            style={{ color: 'inherit', textDecoration: 'none', flex: 1 }}
          >
            {item.title}
          </InternalLink>
          <span
            style={{
              fontSize: '0.6rem',
              transition: 'transform 0.2s',
              transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
              opacity: 0.5,
              flexShrink: 0,
            }}
          >
            ▶
          </span>
        </button>

        {open && (
          <div style={{ marginTop: '0.125rem' }}>
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
        style={{
          display: 'flex',
          alignItems: 'center',
          minHeight: '2.25rem',
          padding: '0.3rem 0.75rem',
          borderRadius: '0.25rem',
          color: isActive ? 'var(--primary)' : 'var(--muted-foreground)',
          background: isActive ? 'var(--primary-dim)' : 'transparent',
          borderLeft: isActive ? '2px solid var(--primary)' : '2px solid transparent',
          fontFamily: 'var(--font-display)',
          fontWeight: 600,
          fontSize: '0.7rem',
          textDecoration: 'none',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          marginTop: '1rem',
          transition: 'color 0.15s, background 0.15s',
        }}
        className="sidebar-item-link"
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
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            minHeight: '2.25rem',
            padding: '0.275rem 0.75rem 0.275rem 1.25rem',
            background: isActive ? 'var(--primary-dim)' : 'transparent',
            border: 'none',
            borderLeft: isActive ? '2px solid var(--primary)' : '2px solid transparent',
            borderRadius: '0 0.25rem 0.25rem 0',
            color: isActive || isChildActive ? 'var(--foreground-hi)' : 'var(--muted-foreground)',
            fontFamily: 'var(--font-body)',
            fontWeight: isActive ? 500 : 400,
            fontSize: '0.825rem',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'color 0.15s, background 0.15s',
          }}
          className="sidebar-item-link"
        >
          <InternalLink
            href={item.href}
            onClick={(e) => e.stopPropagation()}
            style={{ color: 'inherit', textDecoration: 'none', flex: 1 }}
          >
            {item.title}
          </InternalLink>
          <span
            style={{
              fontSize: '0.6rem',
              transition: 'transform 0.2s',
              transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
              opacity: 0.4,
            }}
          >
            ▶
          </span>
        </button>
        {open && (
          <div style={{ marginLeft: '0.5rem' }}>
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
      style={{
        display: 'flex',
        alignItems: 'center',
        minHeight: '2.25rem',
        padding: '0.275rem 0.75rem 0.275rem 1.25rem',
        borderRadius: '0 0.25rem 0.25rem 0',
        borderLeft: isActive ? '2px solid var(--primary)' : '2px solid transparent',
        color: isActive ? 'var(--foreground-hi)' : 'var(--muted-foreground)',
        background: isActive ? 'var(--primary-dim)' : 'transparent',
        fontFamily: 'var(--font-body)',
        fontWeight: isActive ? 500 : 400,
        fontSize: '0.825rem',
        textDecoration: 'none',
        transition: 'color 0.15s, background 0.15s',
      }}
      className="sidebar-item-link"
    >
      {item.title}
    </InternalLink>
  );
}

export function Sidebar({ items, mobileOpen, onClose }: SidebarProps) {
  return (
    <>
      {mobileOpen && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            zIndex: 39,
          }}
        />
      )}

      <aside
        style={{
          position: 'fixed',
          top: 'var(--header-height)',
          left: 0,
          bottom: 0,
          width: 'var(--sidebar-width)',
          overflowY: 'auto',
          overflowX: 'hidden',
          background: 'var(--background)',
          borderRight: '1px solid var(--border)',
          padding: '0.5rem 0.5rem 2rem',
          zIndex: 40,
          transform: mobileOpen ? 'translateX(0)' : undefined,
          display: 'flex',
          flexDirection: 'column',
        }}
        className="docs-sidebar"
      >
        {items.map((item) => (
          <SidebarSection key={item.href} item={item} depth={0} />
        ))}
      </aside>
    </>
  );
}

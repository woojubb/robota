'use client';

import Link from 'next/link';
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

  return (
    <div>
      {hasChildren ? (
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            padding: depth === 0 ? '0.4rem 0.75rem' : '0.3rem 0.75rem 0.3rem 1.25rem',
            background: 'transparent',
            border: 'none',
            borderRadius: '0.375rem',
            color: isActive || isChildActive ? 'var(--primary)' : 'var(--foreground)',
            fontWeight: depth === 0 ? 600 : 400,
            fontSize: depth === 0 ? '0.8rem' : '0.825rem',
            cursor: 'pointer',
            textAlign: 'left',
            opacity: depth === 0 ? 1 : 0.85,
            transition: 'color 0.15s, background 0.15s',
            letterSpacing: depth === 0 ? '0.06em' : undefined,
            textTransform: depth === 0 ? 'uppercase' : undefined,
          }}
        >
          <Link
            href={item.href}
            onClick={(e) => e.stopPropagation()}
            style={{ color: 'inherit', textDecoration: 'none', flex: 1 }}
          >
            {item.title}
          </Link>
          <span
            style={{
              fontSize: '0.65rem',
              transition: 'transform 0.2s',
              transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
              opacity: 0.5,
              flexShrink: 0,
            }}
          >
            ▶
          </span>
        </button>
      ) : (
        <Link
          href={item.href}
          style={{
            display: 'block',
            padding: depth === 0 ? '0.4rem 0.75rem' : '0.3rem 0.75rem 0.3rem 1.25rem',
            borderRadius: '0.375rem',
            color: isActive ? 'var(--primary)' : 'var(--muted-foreground)',
            background: isActive ? 'var(--accent-dim)' : 'transparent',
            fontWeight: isActive ? 500 : 400,
            fontSize: depth === 0 ? '0.8rem' : '0.825rem',
            textDecoration: 'none',
            transition: 'color 0.15s, background 0.15s',
            letterSpacing: depth === 0 ? '0.06em' : undefined,
            textTransform: depth === 0 ? 'uppercase' : undefined,
          }}
        >
          {item.title}
        </Link>
      )}

      {hasChildren && open && (
        <div style={{ marginLeft: depth === 0 ? '0.25rem' : '0.75rem' }}>
          {item.children!.map((child) => (
            <SidebarSection key={child.href} item={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ items, mobileOpen, onClose }: SidebarProps) {
  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 39,
          }}
        />
      )}

      {/* Sidebar panel */}
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
          padding: '1rem 0.5rem',
          zIndex: 40,
          transform: mobileOpen ? 'translateX(0)' : undefined,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.125rem',
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

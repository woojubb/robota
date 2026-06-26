'use client';

import { useState } from 'react';

type TabKey = 'pnpm' | 'npm' | 'yarn';

interface PackageManagerTabsProps {
  npm: string;
  pnpm: string;
  yarn?: string;
}

export function PackageManagerTabs({ npm, pnpm, yarn }: PackageManagerTabsProps) {
  const tabs: { key: TabKey; label: string; command: string }[] = [
    { key: 'pnpm', label: 'pnpm', command: pnpm },
    { key: 'npm', label: 'npm', command: npm },
    ...(yarn ? [{ key: 'yarn' as TabKey, label: 'yarn', command: yarn }] : []),
  ];

  const [active, setActive] = useState<TabKey>('pnpm');
  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <div
      style={{
        border: '1px solid #252540',
        borderRadius: '0.5rem',
        marginBottom: '1.5rem',
        overflow: 'hidden',
      }}
    >
      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid #252540',
          background: '#131320',
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActive(tab.key)}
            style={{
              padding: '0.4rem 1rem',
              fontSize: '0.8rem',
              fontWeight: 500,
              background: 'transparent',
              border: 'none',
              borderBottom:
                active === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
              color: active === tab.key ? 'var(--accent)' : '#7b7a95',
              cursor: 'pointer',
              transition: 'color 0.15s, border-color 0.15s',
              fontFamily: 'ui-monospace, monospace',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Command */}
      <pre
        style={{
          margin: 0,
          padding: '0.875rem 1.25rem',
          background: '#0d1117',
          color: '#e8e6f0',
          fontSize: '0.875rem',
          fontFamily:
            'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace',
          overflowX: 'auto',
          lineHeight: 1.6,
        }}
      >
        <code>{current.command}</code>
      </pre>
    </div>
  );
}

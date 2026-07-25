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
    <div className="mb-6 overflow-hidden rounded-[0.5rem] border border-[#252540]">
      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="Package manager"
        className="flex border-b border-[#252540] bg-[#131320]"
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={active === tab.key}
            onClick={() => setActive(tab.key)}
            className={`cursor-pointer border-0 border-b-2 bg-transparent px-4 py-[0.4rem] [font-family:ui-monospace,monospace] text-[0.8rem] font-medium transition-[color,border-color] duration-150 ${
              active === tab.key
                ? 'border-b-[var(--accent)] text-[var(--accent)]'
                : 'border-b-transparent text-[#7b7a95]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Command */}
      <pre className="m-0 overflow-x-auto bg-[#0d1117] px-5 py-3.5 [font-family:ui-monospace,'Cascadia_Code','Source_Code_Pro',Menlo,Consolas,monospace] text-[0.875rem] leading-[1.6] text-[#e8e6f0]">
        <code>{current.command}</code>
      </pre>
    </div>
  );
}

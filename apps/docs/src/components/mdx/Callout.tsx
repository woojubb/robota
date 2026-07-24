import type { ReactNode } from 'react';

type CalloutType = 'info' | 'warning' | 'danger' | 'tip';

interface CalloutProps {
  type?: CalloutType;
  children: ReactNode;
}

const CALLOUT_STYLES: Record<
  CalloutType,
  { container: string; title: string; icon: string; label: string }
> = {
  info: {
    container: 'border-l-[#3b82f6] bg-[rgba(59,130,246,0.08)]',
    title: 'text-[#3b82f6]',
    icon: 'ℹ',
    label: 'Info',
  },
  tip: {
    container: 'border-l-[#22c55e] bg-[rgba(34,197,94,0.08)]',
    title: 'text-[#22c55e]',
    icon: '💡',
    label: 'Tip',
  },
  warning: {
    container: 'border-l-[#f59e0b] bg-[rgba(245,158,11,0.08)]',
    title: 'text-[#f59e0b]',
    icon: '⚠',
    label: 'Warning',
  },
  danger: {
    container: 'border-l-[#ef4444] bg-[rgba(239,68,68,0.08)]',
    title: 'text-[#ef4444]',
    icon: '🚫',
    label: 'Danger',
  },
};

export function Callout({ type = 'info', children }: CalloutProps) {
  const styles = CALLOUT_STYLES[type];
  return (
    <aside className={`mb-5 rounded-r-[0.375rem] border-l-4 px-4 py-3 ${styles.container}`}>
      <div className={`mb-1 text-[0.85rem] font-semibold ${styles.title}`}>
        {styles.icon} {styles.label}
      </div>
      <div className="text-[0.9rem] leading-[1.65]">{children}</div>
    </aside>
  );
}

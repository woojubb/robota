import type { ReactNode } from 'react';

type CalloutType = 'info' | 'warning' | 'danger' | 'tip';

interface CalloutProps {
  type?: CalloutType;
  children: ReactNode;
}

const CALLOUT_STYLES: Record<
  CalloutType,
  { border: string; bg: string; icon: string; label: string }
> = {
  info: {
    border: '#3b82f6',
    bg: 'rgba(59,130,246,0.08)',
    icon: 'ℹ',
    label: 'Info',
  },
  tip: {
    border: '#22c55e',
    bg: 'rgba(34,197,94,0.08)',
    icon: '💡',
    label: 'Tip',
  },
  warning: {
    border: '#f59e0b',
    bg: 'rgba(245,158,11,0.08)',
    icon: '⚠',
    label: 'Warning',
  },
  danger: {
    border: '#ef4444',
    bg: 'rgba(239,68,68,0.08)',
    icon: '🚫',
    label: 'Danger',
  },
};

export function Callout({ type = 'info', children }: CalloutProps) {
  const styles = CALLOUT_STYLES[type];
  return (
    <aside
      style={{
        borderLeft: `4px solid ${styles.border}`,
        background: styles.bg,
        borderRadius: '0 0.375rem 0.375rem 0',
        padding: '0.75rem 1rem',
        marginBottom: '1.25rem',
      }}
    >
      <div
        style={{
          fontWeight: 600,
          fontSize: '0.85rem',
          marginBottom: '0.25rem',
          color: styles.border,
        }}
      >
        {styles.icon} {styles.label}
      </div>
      <div style={{ fontSize: '0.9rem', lineHeight: 1.65 }}>{children}</div>
    </aside>
  );
}

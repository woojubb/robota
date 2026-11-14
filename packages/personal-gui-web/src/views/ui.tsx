/** Small building blocks the menu views share, styled with the shared surface's tokens. */
import type { ReactNode } from 'react';

export function ViewFrame({
  title,
  actions,
  children,
}: {
  readonly title: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}): React.ReactElement {
  return (
    <section aria-label={title} className="flex h-full flex-col">
      <header className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-border px-4">
        <h1 className="text-[15px] font-semibold">{title}</h1>
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

export function Button({
  children,
  onClick,
  tone = 'default',
  type = 'button',
  disabled,
}: {
  readonly children: ReactNode;
  readonly onClick?: () => void;
  readonly tone?: 'default' | 'primary' | 'danger';
  readonly type?: 'button' | 'submit';
  readonly disabled?: boolean;
}): React.ReactElement {
  const tones = {
    default: 'border border-border text-foreground hover:bg-hover',
    primary: 'bg-primary text-primary-foreground hover:opacity-90',
    danger: 'border border-border text-destructive hover:bg-hover',
  } as const;
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-[13px] font-medium disabled:opacity-50 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

export function Notice({
  children,
  tone = 'muted',
}: {
  readonly children: ReactNode;
  readonly tone?: 'muted' | 'error';
}): React.ReactElement {
  return (
    <p
      className={`px-4 py-3 text-[13px] ${tone === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
    >
      {children}
    </p>
  );
}

export const inputClass =
  'w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[14px] text-foreground';

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A moment in the viewer's own time zone, short. */
export function when(iso: string | undefined): string {
  if (iso === undefined) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** A repeat interval in the largest whole unit: every 2 hours, every week. */
export function interval(minutes: number): string {
  for (const [size, unit] of [
    [10_080, 'week'],
    [1_440, 'day'],
    [60, 'hour'],
    [1, 'minute'],
  ] as const) {
    if (minutes % size === 0) {
      const count = minutes / size;
      return count === 1 ? `Every ${unit}` : `Every ${count} ${unit}s`;
    }
  }
  return `Every ${minutes} minutes`;
}

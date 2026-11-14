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

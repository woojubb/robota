import type { IWsSessionState } from '../hooks/useSessionClient.js';

const STATUS_DOT: Record<string, string> = {
  connected: 'bg-primary status-glow',
  connecting: 'bg-amber-400 animate-pulse',
  disconnected: 'bg-zinc-600',
  error: 'bg-rose-500',
};

/** Title bar with connection state and the desktop-only Personal Usage navigation. */
export function SessionTitleBar({
  status,
  surface,
  view,
  onView,
  personalUsageEnabled,
}: {
  status: string;
  surface?: string;
  view: 'chat' | 'usage';
  onView: (view: 'chat' | 'usage') => void;
  personalUsageEnabled: boolean;
}): React.ReactElement {
  const dot = STATUS_DOT[status] ?? STATUS_DOT.disconnected;
  return (
    <header
      className="agent-gui-status flex h-11 flex-shrink-0 items-center gap-3 border-b border-border/70 bg-card/40 px-4 backdrop-blur-sm"
      data-status={status}
    >
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-primary status-glow" />
        <span className="font-mono text-[13px] font-semibold tracking-[0.22em] text-foreground/90">
          robota
        </span>
        {surface ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60">
            {surface}
          </span>
        ) : null}
      </div>
      <span className="text-border/70">/</span>
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        <span className="font-mono text-[11px] text-muted-foreground">{status}</span>
      </div>
      {personalUsageEnabled ? (
        <nav
          className="ml-auto flex items-center rounded-md border border-border/60 bg-background/40 p-0.5"
          aria-label="Primary"
        >
          {(['chat', 'usage'] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={view === item}
              onClick={() => onView(item)}
              className={`rounded px-2.5 py-1 font-mono text-[10px] capitalize tracking-[0.08em] ${
                view === item
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {item === 'chat' ? 'Chat' : 'Usage'}
            </button>
          ))}
        </nav>
      ) : (
        <span className="ml-auto" />
      )}
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/50">
        <span className="rounded border border-border/60 px-1.5 py-0.5">local · owner</span>
      </div>
    </header>
  );
}

/** Visible, dismissible command and protocol/session outcomes. */
export function SessionNotices({ state }: { state: IWsSessionState }): React.ReactElement | null {
  const notices = state.sessionNotices ?? [];
  if (notices.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 border-b border-border/50 bg-card/40 px-4 py-2">
      {notices.map((notice) => (
        <div
          key={notice.id}
          role={notice.kind === 'command-result' && notice.success ? 'status' : 'alert'}
          className={`flex items-center gap-3 font-mono text-[12px] ${
            notice.kind === 'command-result' && notice.success
              ? 'text-primary/90'
              : 'text-rose-300/90'
          }`}
        >
          <span className="flex-1">{notice.message}</span>
          <button
            type="button"
            aria-label="Dismiss notice"
            onClick={() => state.dismissSessionNotice?.(notice.id)}
            className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}

import type { IWsSessionState } from '../hooks/useSessionClient.js';

type TListedSession = NonNullable<IWsSessionState['sessionListing']>['sessions'][number];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5m ago", "3h ago", "2d ago", then the date. */
export function formatUpdatedAt(updatedAt: string, now: number = Date.now()): string {
  const at = Date.parse(updatedAt);
  if (Number.isNaN(at)) return '';
  const elapsed = Math.max(0, now - at);
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d ago`;
  return new Date(at).toISOString().slice(0, 10);
}

function sessionTitle(session: TListedSession): string {
  const name = session.name?.trim();
  if (name) return name;
  const preview = session.preview.trim();
  return preview.length > 0 ? preview : 'New session';
}

/**
 * #3189 — this workspace's sessions on the left of the conversation, as in Claude Code Desktop:
 * start a new one, or click another to make it current. Rows the host could not read are listed,
 * disabled, so a damaged session never looks deleted. A refused switch comes back as a notice.
 */
export function SessionSidebar({
  state,
  className,
}: {
  state: IWsSessionState;
  className?: string;
}): React.ReactElement {
  const listing = state.sessionListing ?? null;
  const current = listing?.currentSessionId ?? null;
  const unreadable = listing?.unreadableSessionIds ?? [];
  const failed = state.sessionsError?.code === 'list_failed' ? state.sessionsError.message : null;

  return (
    <aside
      aria-label="Sessions"
      className={`flex w-64 flex-shrink-0 flex-col overflow-hidden border-r border-border/70 bg-card/95 md:bg-card/15 ${className ?? ''}`}
    >
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-border/50 px-3 py-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Sessions
        </span>
        <button
          type="button"
          aria-label="Hide sessions"
          onClick={() => state.setSessionSidebarOpen?.(false)}
          className="ml-auto rounded px-1.5 font-mono text-[13px] leading-none text-muted-foreground hover:text-foreground"
        >
          «
        </button>
      </div>

      <div className="flex-shrink-0 px-2 pt-2">
        <button
          type="button"
          onClick={() => state.newSession?.()}
          className="flex w-full items-center gap-2 rounded-md border border-border/60 bg-background/40 px-2.5 py-1.5 font-mono text-[11px] text-foreground/85 hover:border-primary/40 hover:text-primary"
        >
          <span className="text-primary">+</span> New session
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {failed !== null ? (
          <p className="px-1 py-1 font-mono text-[11px] leading-snug text-rose-300/80">{failed}</p>
        ) : null}
        {listing === null && failed === null ? (
          <p className="px-1 py-1 font-mono text-[11px] text-muted-foreground/60">Loading sessions…</p>
        ) : null}
        <ul className="space-y-1">
          {(listing?.sessions ?? []).map((session) => {
            const isCurrent = session.id === current;
            return (
              <li key={session.id}>
                <button
                  type="button"
                  aria-current={isCurrent ? 'true' : undefined}
                  title={session.preview || session.id}
                  onClick={() => {
                    if (!isCurrent) state.switchSession?.(session.id);
                  }}
                  className={`relative w-full overflow-hidden rounded-md border px-2.5 py-1.5 text-left ${
                    isCurrent
                      ? 'border-primary/30 bg-primary/10'
                      : 'border-transparent hover:border-border/60 hover:bg-card/40'
                  }`}
                >
                  {isCurrent ? (
                    <span className="absolute bottom-0 left-0 top-0 w-0.5 bg-primary" />
                  ) : null}
                  <span
                    className={`block truncate font-mono text-[11px] leading-snug ${
                      isCurrent ? 'text-primary' : 'text-foreground/85'
                    }`}
                  >
                    {sessionTitle(session)}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 font-mono text-[10px] tabular-nums text-muted-foreground/60">
                    <span>{formatUpdatedAt(session.updatedAt)}</span>
                    <span className="ml-auto">
                      {session.messageCount} {session.messageCount === 1 ? 'msg' : 'msgs'}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
          {unreadable.length > 0 && (
            // Listed, never dropped, so an unreadable session does not look deleted — but as one
            // folded line: a store can hold many old records, and each is nothing to click.
            <li>
              <details className="px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground/60">
                <summary className="cursor-pointer text-rose-300/70">
                  {unreadable.length} {unreadable.length === 1 ? 'session' : 'sessions'} could not be
                  read
                </summary>
                <ul className="mt-1 space-y-0.5">
                  {unreadable.map((id) => (
                    <li key={id} className="truncate">
                      {id}
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          )}
        </ul>
      </div>
    </aside>
  );
}

/** The collapsed sidebar: a narrow rail that opens it again. */
export function SessionSidebarRail({ state }: { state: IWsSessionState }): React.ReactElement {
  return (
    <div className="flex w-9 flex-shrink-0 flex-col items-center border-r border-border/70 bg-card/15 py-2">
      <button
        type="button"
        aria-label="Show sessions"
        onClick={() => state.setSessionSidebarOpen?.(true)}
        className="rounded px-1.5 py-1 font-mono text-[13px] leading-none text-muted-foreground hover:text-foreground"
      >
        »
      </button>
    </div>
  );
}

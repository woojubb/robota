import { PanelLeftClose, PanelLeftOpen, SquarePen } from 'lucide-react';

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

/** A session's title: its name, else its first message, else "New session". */
export function sessionTitle(session: TListedSession): string {
  const name = session.name?.trim();
  if (name) return name;
  const preview = session.preview.trim();
  return preview.length > 0 ? preview : 'New session';
}

/**
 * The clients on a row besides this surface: its own row counts this surface among them. Null when
 * the host does not count clients, or no one else is there.
 */
export function otherClients(session: TListedSession, isCurrent: boolean): number | null {
  if (session.clients === undefined) return null;
  const others = session.clients - (isCurrent ? 1 : 0);
  return others >= 1 ? others : null;
}

/**
 * #3189 — this workspace's sessions on the left of the conversation, as in Claude Code Desktop:
 * start a new one, or click another to make it current. Rows the host could not read are listed,
 * disabled, so a damaged session never looks deleted. A refused switch comes back as a notice.
 * A host that keeps several sessions live marks the rows running now and counts who else is on them.
 */
export function SessionSidebar({
  state,
  brand,
  className,
}: {
  state: IWsSessionState;
  /** The app's name, shown at the top of the sidebar while it is open. */
  brand?: React.ReactNode;
  className?: string;
}): React.ReactElement {
  const listing = state.sessionListing ?? null;
  const current = listing?.currentSessionId ?? null;
  const unreadable = listing?.unreadableSessionIds ?? [];
  const failed = state.sessionsError?.code === 'list_failed' ? state.sessionsError.message : null;

  return (
    <aside
      aria-label="Sessions"
      className={`flex w-[272px] flex-shrink-0 flex-col overflow-hidden bg-sidebar ${className ?? ''}`}
    >
      <div className="flex h-12 flex-shrink-0 items-center gap-2 px-4">
        {brand}
        <button
          type="button"
          aria-label="Hide sessions"
          title="Hide sessions"
          onClick={() => state.setSessionSidebarOpen?.(false)}
          className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          <PanelLeftClose size={17} strokeWidth={1.75} />
        </button>
      </div>

      <div className="flex-shrink-0 px-2.5 pt-1">
        <button
          type="button"
          onClick={() => state.newSession?.()}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] font-medium text-foreground hover:bg-hover"
        >
          <SquarePen size={16} strokeWidth={1.75} className="text-muted-foreground" />
          New session
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 pb-3 pt-4">
        <h2 className="px-2.5 pb-1.5 text-[12.5px] font-medium text-subtle">Sessions</h2>
        {failed !== null ? (
          <p className="px-2.5 py-1 text-[13px] leading-snug text-destructive">{failed}</p>
        ) : null}
        {listing === null && failed === null ? (
          <p className="px-2.5 py-1 text-[13px] text-subtle">Loading sessions…</p>
        ) : null}
        <ul className="space-y-px">
          {(listing?.sessions ?? []).map((session) => {
            const isCurrent = session.id === current;
            const others = otherClients(session, isCurrent);
            return (
              <li key={session.id}>
                <button
                  type="button"
                  aria-current={isCurrent ? 'true' : undefined}
                  title={session.preview || session.id}
                  onClick={() => {
                    if (!isCurrent) state.switchSession?.(session.id);
                  }}
                  className={`w-full rounded-lg px-2.5 py-2 text-left transition-colors ${
                    isCurrent ? 'bg-raised' : 'hover:bg-hover'
                  }`}
                >
                  <span
                    className={`block truncate text-[14px] leading-snug ${
                      isCurrent ? 'font-medium text-foreground' : 'text-foreground/85'
                    }`}
                  >
                    {sessionTitle(session)}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px] tabular-nums text-subtle">
                    {session.live === true ? (
                      <span
                        title="Live in the host"
                        className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent"
                      >
                        <span className="sr-only">live</span>
                      </span>
                    ) : null}
                    <span>{formatUpdatedAt(session.updatedAt)}</span>
                    {others !== null ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-muted-foreground">
                          {others} {others === 1 ? 'other' : 'others'}
                        </span>
                      </>
                    ) : null}
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
              <details className="px-2.5 py-2 text-[12.5px] text-subtle">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  {unreadable.length} {unreadable.length === 1 ? 'session' : 'sessions'} could not
                  be read
                </summary>
                <ul className="mt-1.5 space-y-0.5 font-mono text-[11.5px]">
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
    <div className="flex w-12 flex-shrink-0 flex-col items-center gap-1 bg-sidebar py-2.5">
      <button
        type="button"
        aria-label="Show sessions"
        title="Show sessions"
        onClick={() => state.setSessionSidebarOpen?.(true)}
        className="rounded-md p-1.5 text-muted-foreground hover:bg-hover hover:text-foreground"
      >
        <PanelLeftOpen size={17} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        aria-label="New session"
        title="New session"
        onClick={() => state.newSession?.()}
        className="rounded-md p-1.5 text-muted-foreground hover:bg-hover hover:text-foreground"
      >
        <SquarePen size={16} strokeWidth={1.75} />
      </button>
    </div>
  );
}

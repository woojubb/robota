import {
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Settings,
  SquarePen,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

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

/**
 * A session's title (#3289 §1): its name, else its stable first-message title, else "New session".
 * Never `preview` — that field is the raw latest reply, which is what changes every turn and is what
 * this title exists to stop showing.
 */
export function sessionTitle(session: TListedSession): string {
  const name = session.name?.trim();
  if (name) return name;
  const title = session.title?.trim();
  if (title) return title;
  return 'New session';
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

/** Where a row's context menu opens: the point the mouse or the "More" button gave it. */
interface IMenuAnchor {
  readonly sessionId: string;
  readonly x: number;
  readonly y: number;
}

/**
 * #3189 — this workspace's sessions on the left of the conversation, as in Claude Code Desktop:
 * start a new one, or click another to make it current. Rows the host could not read are listed,
 * disabled, so a damaged session never looks deleted. A refused switch comes back as a notice.
 * A host that keeps several sessions live marks the rows running now and counts who else is on them.
 *
 * #3289 §1 — each row also carries a "More" menu (or right-click) with Rename (inline) and Delete
 * (confirmed). Rename on the current row reuses the `/rename` command, which also updates the live
 * session's own name and title bar; rename on any other row writes the stored record directly.
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

  const [menu, setMenu] = useState<IMenuAnchor | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // A menu closes on Escape or a click outside it — the usual context-menu contract.
  useEffect(() => {
    if (menu === null) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(null);
    };
    const onPointerDown = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenu(null);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [menu]);

  const openMenuAt = (sessionId: string, x: number, y: number): void => setMenu({ sessionId, x, y });

  const startRename = (session: TListedSession): void => {
    setMenu(null);
    setRenamingId(session.id);
    setRenameValue(sessionTitle(session));
  };

  const saveRename = (session: TListedSession): void => {
    const name = renameValue.trim();
    setRenamingId(null);
    if (name.length === 0 || name === sessionTitle(session)) return;
    if (session.id === current) {
      // The current session's own rename path: it also updates the live name and title bar.
      state.send({ type: 'command', name: 'rename', args: name });
    } else {
      state.renameSessionInList?.(session.id, name);
    }
  };

  const rows = listing?.sessions ?? [];
  const confirmingSession = rows.find((row) => row.id === confirmDeleteId) ?? null;

  return (
    <aside
      aria-label="Sessions"
      className={`robota-ui flex w-[272px] flex-shrink-0 flex-col overflow-hidden bg-sidebar ${className ?? ''}`}
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
          {rows.map((session) => {
            const isCurrent = session.id === current;
            const others = otherClients(session, isCurrent);
            const isRenaming = renamingId === session.id;
            // #3289 §3 review: the explicit `aria-label` below replaces name-from-content outright, so
            // the live dot's and "N other(s)" span's own text no longer reaches the accessible name —
            // folded back in here as a description instead, alongside the relative time.
            const statusParts = [
              session.live === true ? 'Live' : null,
              others !== null ? `${others} ${others === 1 ? 'other' : 'others'}` : null,
            ].filter((part): part is string => part !== null);
            const statusId = `session-status-${session.id}`;
            const updatedId = `session-updated-${session.id}`;
            const describedBy =
              statusParts.length > 0 ? `${updatedId} ${statusId}` : updatedId;
            return (
              <li key={session.id} className="group relative">
                {isRenaming ? (
                  <input
                    autoFocus
                    aria-label={`Rename ${sessionTitle(session)}`}
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onBlur={() => saveRename(session)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        saveRename(session);
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        setRenamingId(null);
                      }
                    }}
                    className="w-full rounded-lg border border-accent bg-raised px-2.5 py-2 text-[14px] text-foreground outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    aria-current={isCurrent ? 'true' : undefined}
                    // #3289 §3: an explicit name + description — the row's own visible text has no
                    // whitespace between its parts, so an unlabelled button reads as one run-together
                    // string ("Title validation fixjust now") to a screen reader.
                    aria-label={sessionTitle(session)}
                    aria-describedby={describedBy}
                    title={session.preview || session.id}
                    onClick={() => {
                      if (!isCurrent) state.switchSession?.(session.id);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      openMenuAt(session.id, event.clientX, event.clientY);
                    }}
                    className={`w-full rounded-lg py-2 pl-2.5 pr-8 text-left transition-colors ${
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
                      <span id={updatedId}>{formatUpdatedAt(session.updatedAt)}</span>
                      {others !== null ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-muted-foreground">
                            {others} {others === 1 ? 'other' : 'others'}
                          </span>
                        </>
                      ) : null}
                      {statusParts.length > 0 ? (
                        <span id={statusId} className="sr-only">
                          {statusParts.join(', ')}
                        </span>
                      ) : null}
                    </span>
                  </button>
                )}
                {!isRenaming ? (
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) moreButtonRefs.current.set(session.id, el);
                      else moreButtonRefs.current.delete(session.id);
                    }}
                    aria-label={`More for ${sessionTitle(session)}`}
                    aria-haspopup="menu"
                    aria-expanded={menu?.sessionId === session.id}
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      openMenuAt(session.id, rect.left, rect.bottom);
                    }}
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground opacity-0 hover:bg-hover hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <MoreHorizontal size={15} strokeWidth={1.75} />
                  </button>
                ) : null}
              </li>
            );
          })}
          {unreadable.length > 0 && (
            // Listed, never dropped, so an unreadable session does not look deleted — but as one
            // folded line: a store can hold many old records, and each is nothing to click.
            <li>
              <details className="px-2.5 py-2 text-[12.5px] text-subtle">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  {unreadable.length} older {unreadable.length === 1 ? 'session' : 'sessions'} in
                  this folder can&apos;t be opened
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

      <div className="flex-shrink-0 border-t border-border/60 px-2.5 py-2">
        <button
          type="button"
          aria-label="Settings"
          title="Settings"
          onClick={() => state.openSettings()}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          <Settings size={16} strokeWidth={1.75} />
          Settings
        </button>
      </div>

      {menu !== null
        ? (() => {
            const session = rows.find((row) => row.id === menu.sessionId);
            if (!session) return null;
            return (
              <div
                ref={menuRef}
                role="menu"
                aria-label={`Actions for ${sessionTitle(session)}`}
                style={{ position: 'fixed', left: menu.x, top: menu.y }}
                className="gui-rise z-40 min-w-[140px] overflow-hidden rounded-lg bg-popover py-1 text-popover-foreground shadow-xl shadow-black/30"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => startRename(session)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13.5px] hover:bg-hover"
                >
                  <Pencil size={14} strokeWidth={1.75} />
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(null);
                    setConfirmDeleteId(session.id);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13.5px] text-destructive hover:bg-hover"
                >
                  <Trash2 size={14} strokeWidth={1.75} />
                  Delete…
                </button>
              </div>
            );
          })()
        : null}

      {confirmingSession !== null ? (
        <div
          role="presentation"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-session-title"
            className="gui-rise w-full max-w-[380px] rounded-xl bg-popover p-5 text-popover-foreground shadow-2xl"
          >
            <h2 id="delete-session-title" className="text-[15px] font-medium">
              Delete &ldquo;{sessionTitle(confirmingSession)}&rdquo;?
            </h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
              This removes its conversation from this computer.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="rounded-lg px-3 py-1.5 text-[13.5px] font-medium text-foreground hover:bg-hover"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  state.deleteSession?.(confirmingSession.id);
                  setConfirmDeleteId(null);
                }}
                className="rounded-lg bg-destructive/12 px-3 py-1.5 text-[13.5px] font-medium text-destructive hover:bg-destructive/20"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
      <button
        type="button"
        aria-label="Settings"
        title="Settings"
        onClick={() => state.openSettings()}
        className="mt-auto rounded-md p-1.5 text-muted-foreground hover:bg-hover hover:text-foreground"
      >
        <Settings size={16} strokeWidth={1.75} />
      </button>
    </div>
  );
}

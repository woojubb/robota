import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { RobotaWordmark } from './Brand.js';

import type { IWsSessionState } from '../hooks/useSessionClient.js';

const STATUS: Record<string, { dot: string; label: string }> = {
  connected: { dot: 'bg-accent status-glow', label: 'Connected' },
  connecting: { dot: 'bg-warning animate-pulse', label: 'Connecting…' },
  disconnected: { dot: 'bg-subtle', label: 'Disconnected' },
  error: { dot: 'bg-destructive', label: 'Connection error' },
};

/**
 * The bar over the conversation: the app's name when no sidebar carries it, the current session's
 * title, the desktop-only Chat / Usage switch, and the connection state. The state is a dot while all
 * is well and says itself in words once it is not.
 */
export function SessionTitleBar({
  status,
  surface,
  title,
  showBrand,
  view,
  onView,
  personalUsageEnabled,
}: {
  status: string;
  surface?: string;
  title?: string | null;
  showBrand: boolean;
  view: 'chat' | 'usage';
  onView: (view: 'chat' | 'usage') => void;
  personalUsageEnabled: boolean;
}): React.ReactElement {
  const state = STATUS[status] ?? STATUS.disconnected;
  return (
    <header
      className="agent-gui-status flex h-12 flex-shrink-0 items-center gap-3 px-5"
      data-status={status}
    >
      {showBrand ? <RobotaWordmark surface={surface} /> : null}
      {/* The usage view titles itself; the chat view is titled by its session. */}
      {view === 'chat' && title ? (
        <h1 className="min-w-0 truncate text-[14px] font-medium text-foreground/90">{title}</h1>
      ) : null}
      <div className="ml-auto flex items-center gap-3">
        {personalUsageEnabled ? (
          <nav className="flex items-center rounded-lg bg-raised p-0.5" aria-label="Primary">
            {(['chat', 'usage'] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={view === item}
                onClick={() => onView(item)}
                className={`rounded-md px-3 py-1 text-[13px] font-medium transition-colors ${
                  view === item
                    ? 'bg-card text-foreground shadow-sm shadow-black/25'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {item === 'chat' ? 'Chat' : 'Usage'}
              </button>
            ))}
          </nav>
        ) : null}
        <span className="flex items-center gap-2" title={state.label}>
          <span className={`h-2 w-2 rounded-full ${state.dot}`} />
          {status === 'connected' ? (
            <span className="sr-only">{status}</span>
          ) : (
            <span className="text-[13px] text-muted-foreground">{status}</span>
          )}
        </span>
      </div>
    </header>
  );
}

/** The column every part of the conversation shares (matches `SessionSurface`'s `COLUMN`). */
const BANNER_COLUMN = 'mx-auto w-full max-w-[760px] px-6';

/**
 * A connection that drops after a working session (issue #3280 §5): a banner directly above the
 * conversation — never a full-screen replacement — so the conversation and its history stay visible
 * and scrollable throughout. Shown as soon as the drop happens; says nothing on the very first
 * connect, because nothing has been lost yet.
 */
export function ConnectionBanner({
  status,
  connectionLost,
  onReconnect,
}: {
  status: string;
  /** Retries ran out: the runtime is not coming back by itself (`useWsSession`'s `connectionLost`). */
  connectionLost: boolean;
  /** Present only when the host can restart the runtime (desktop); absent in the browser. */
  onReconnect?: () => Promise<void>;
}): React.ReactElement | null {
  const everConnectedRef = useRef(false);
  useEffect(() => {
    if (status === 'connected') everConnectedRef.current = true;
  }, [status]);
  const [reconnecting, setReconnecting] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  if (status === 'connected') return null;
  if (!connectionLost && !everConnectedRef.current) return null;

  if (!connectionLost) {
    return (
      <div role="status" className={`${BANNER_COLUMN} flex-shrink-0 pt-3`}>
        <div className="flex items-center gap-2.5 rounded-xl bg-warning/15 px-4 py-2.5 text-[13.5px] text-foreground">
          <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-warning" aria-hidden="true" />
          Connection lost. Reconnecting…
        </div>
      </div>
    );
  }

  const reconnect = (): void => {
    if (!onReconnect) return;
    setReconnecting(true);
    setFailed(null);
    onReconnect().catch((error: unknown) => {
      setReconnecting(false);
      setFailed(error instanceof Error ? error.message : String(error));
    });
  };

  return (
    <div role="alert" className={`${BANNER_COLUMN} flex-shrink-0 pt-3`}>
      <div className="flex flex-col gap-2 rounded-xl bg-destructive/15 px-4 py-3 text-[13.5px] text-foreground">
        <div className="flex flex-wrap items-center gap-3">
          <span className="h-2 w-2 flex-shrink-0 rounded-full bg-destructive" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            Robota stopped.
            {!onReconnect && (
              <>
                {' '}
                Run <code className="font-mono">robota --serve --open</code> again to reopen it.
              </>
            )}
          </span>
          {onReconnect ? (
            <button
              type="button"
              onClick={reconnect}
              disabled={reconnecting}
              className="flex-shrink-0 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              {reconnecting ? 'Reconnecting…' : 'Reconnect'}
            </button>
          ) : null}
        </div>
        {failed ? <p className="text-destructive">{failed}</p> : null}
      </div>
    </div>
  );
}

/**
 * Session and protocol failures, as dismissible toasts over the top-right corner: they stay until
 * dismissed, and never push the conversation or the composer out of view. Command output is not
 * here — it belongs to the conversation.
 */
export function SessionNotices({ state }: { state: IWsSessionState }): React.ReactElement | null {
  const notices = state.sessionNotices ?? [];
  if (notices.length === 0) return null;
  return (
    <div className="pointer-events-none absolute right-4 top-16 z-40 flex w-[min(400px,calc(100%-32px))] flex-col gap-2">
      {notices.slice(-3).map((notice) => (
        <div
          key={notice.id}
          role="alert"
          className="gui-rise pointer-events-auto flex items-start gap-3 rounded-xl bg-popover px-4 py-3 text-[14px] leading-snug text-popover-foreground shadow-xl shadow-black/30"
        >
          <span className="mt-[7px] h-2 w-2 flex-shrink-0 rounded-full bg-destructive" />
          <span className="max-h-40 flex-1 overflow-y-auto whitespace-pre-wrap break-words">
            {notice.message}
          </span>
          <button
            type="button"
            aria-label="Dismiss notice"
            onClick={() => state.dismissSessionNotice?.(notice.id)}
            className="-mr-1 rounded-md p-1 text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

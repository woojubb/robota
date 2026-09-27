import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { RobotaWordmark } from './Brand.js';

import type { ISessionNotice } from '../hooks/session-client-types.js';
import type { IWsSessionState } from '../hooks/useSessionClient.js';

const STATUS: Record<string, { dot: string; label: string }> = {
  connected: { dot: 'bg-accent status-glow', label: 'Connected' },
  connecting: { dot: 'bg-warning animate-pulse', label: 'Connecting…' },
  disconnected: { dot: 'bg-subtle', label: 'Disconnected' },
  error: { dot: 'bg-destructive', label: 'Connection error' },
};

/**
 * #3289 §1 — the folder this session works in, wherever `document.title` is settable: a page (the
 * browser tab) and the desktop window that loads it (Electron follows the page's title unless told
 * otherwise, and nothing in `apps/agent-app/electron/main.ts` overrides it — see its own SPEC note).
 * Absent while the host has not said, so a not-yet-connected surface keeps whatever title it loaded
 * with rather than announcing "undefined — Robota".
 */
function useWorkspaceDocumentTitle(workspace: { readonly name: string } | undefined): void {
  useEffect(() => {
    if (typeof document === 'undefined' || workspace === undefined) return;
    document.title = `${workspace.name} — Robota`;
  }, [workspace]);
}

/**
 * The bar over the conversation: the app's name when no sidebar carries it, the workspace folder and
 * the current session's title, the desktop-only Chat / Usage switch, and the connection state. The
 * state is a dot while all is well and says itself in words once it is not.
 */
export function SessionTitleBar({
  status,
  surface,
  title,
  workspace,
  showBrand,
  view,
  onView,
  personalUsageEnabled,
}: {
  status: string;
  surface?: string;
  title?: string | null;
  /** The folder this session works in (#3289 §1); absent when the host has not said. */
  workspace?: { readonly name: string; readonly path: string };
  showBrand: boolean;
  view: 'chat' | 'usage';
  onView: (view: 'chat' | 'usage') => void;
  personalUsageEnabled: boolean;
}): React.ReactElement {
  const state = STATUS[status] ?? STATUS.disconnected;
  useWorkspaceDocumentTitle(workspace);
  return (
    <header
      className="agent-gui-status flex h-12 flex-shrink-0 items-center gap-3 px-5"
      data-status={status}
    >
      {showBrand ? <RobotaWordmark surface={surface} /> : null}
      {/* The usage view titles itself; the chat view is titled by its session and workspace. */}
      {view === 'chat' && title ? (
        <h1 className="min-w-0 truncate text-[14px] font-medium text-foreground/90">{title}</h1>
      ) : null}
      {view === 'chat' && workspace ? (
        <span
          title={workspace.path}
          className="min-w-0 flex-shrink truncate text-[13px] text-muted-foreground"
        >
          {workspace.name}
        </span>
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

/** The built-in providers whose id does not just-capitalize into their real name (`openai` → `OpenAI`). */
const PROVIDER_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
};

/** `anthropic` → `Anthropic`; a name with its own casing (`openai` → `OpenAI`) uses that instead. */
function displayProvider(provider: string | undefined): string {
  if (provider === undefined || provider.length === 0) return 'The provider';
  return PROVIDER_DISPLAY_NAMES[provider] ?? provider[0].toUpperCase() + provider.slice(1);
}

/**
 * A provider/session error classified at the wire boundary (#3289 §3) as one plain sentence naming
 * what happened and, where there is one, the next step — `null` for a notice this classification does
 * not cover, which keeps showing its own `message` instead.
 *
 * `model_unavailable` names `notice.model` — captured on the notice when it was created — and never
 * the session's current model: a still-open notice must keep blaming the model that actually failed
 * even after the person switches to a different one (the very fix the notice suggests).
 */
function noticeSentence(notice: ISessionNotice): string | null {
  const provider = displayProvider(notice.provider);
  switch (notice.code) {
    case 'auth':
      return `${provider} rejected the API key. Check the key for this provider.`;
    case 'rate_limit': {
      const wait =
        notice.retryAfterSeconds !== undefined
          ? `${notice.retryAfterSeconds} second${notice.retryAfterSeconds === 1 ? '' : 's'}`
          : 'a moment';
      return `${provider} is limiting requests. Try again in ${wait}.`;
    }
    case 'model_unavailable':
      return notice.model
        ? `The model "${notice.model}" isn't available with this key.`
        : "The model isn't available with this key.";
    case 'network':
      return `Can't reach ${provider}. Check your connection.`;
    case 'provider':
      return `${provider} returned an error.`;
    default:
      return null;
  }
}

/**
 * Session and protocol failures, as dismissible toasts over the top-right corner: they stay until
 * dismissed, and never push the conversation or the composer out of view. Command output is not
 * here — it belongs to the conversation. A provider error classified at the wire boundary shows one
 * plain sentence with the next step; its raw text sits behind "Details" rather than as the headline.
 */
export function SessionNotices({ state }: { state: IWsSessionState }): React.ReactElement | null {
  const notices = state.sessionNotices ?? [];
  if (notices.length === 0) return null;
  return (
    <div className="pointer-events-none absolute right-4 top-16 z-40 flex w-[min(400px,calc(100%-32px))] flex-col gap-2">
      {notices.slice(-3).map((notice) => {
        const sentence = noticeSentence(notice);
        return (
          <div
            key={notice.id}
            role="alert"
            className="gui-rise pointer-events-auto flex items-start gap-3 rounded-xl bg-popover px-4 py-3 text-[14px] leading-snug text-popover-foreground shadow-xl shadow-black/30"
          >
            <span className="mt-[7px] h-2 w-2 flex-shrink-0 rounded-full bg-destructive" />
            <span className="max-h-40 flex-1 overflow-y-auto whitespace-pre-wrap break-words">
              {sentence ?? notice.message}
              {sentence && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-[12.5px] text-muted-foreground hover:text-foreground">
                    Details
                  </summary>
                  <p className="mt-1 whitespace-pre-wrap break-words text-[12.5px] text-muted-foreground">
                    {notice.message}
                  </p>
                </details>
              )}
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
        );
      })}
    </div>
  );
}

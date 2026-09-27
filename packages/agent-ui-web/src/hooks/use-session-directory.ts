import { useCallback, useRef, useState } from 'react';

import type { IWsSessionState, TSessionListing, TSessionsError } from './session-client-types.js';
import type { TClientMessage } from '../client/ws-session-client.js';
import type { TServerMessage } from '@robota-sdk/agent-transport';

type TSessionDirectoryState = Pick<
  IWsSessionState,
  | 'sessionListing'
  | 'sessionsError'
  | 'requestSessions'
  | 'switchSession'
  | 'newSession'
  | 'sessionSidebarOpen'
  | 'setSessionSidebarOpen'
>;

let requestCounter = 0;
function nextRequestId(kind: 'sessions' | 'session_change'): string {
  requestCounter += 1;
  return `${kind}_${requestCounter}_${Date.now()}`;
}

/** A host that keeps several sessions live says which rows are; an older host says nothing. */
function keepsSessionsLive(listing: TSessionListing): boolean {
  return listing.sessions.some((row) => typeof row.live === 'boolean');
}

/**
 * Issue #3280 §5: a desktop Reconnect reloads the page, which loses every bit of JS state — so the
 * session to go back to cannot live in a ref like `lastSwitchedIdRef` below. `sessionStorage` survives
 * the reload (and only that tab), so it carries the id across it. Namespaced so a page hosting other
 * state under the same origin does not collide.
 */
const RESTORE_SESSION_STORAGE_KEY = 'robota.restoreSessionId';

/**
 * Remember `sessionId` so the reload a desktop Reconnect triggers can switch back to it once the
 * first session listing arrives (see {@link useSessionDirectoryState}). Best-effort: a host whose
 * storage is unavailable simply lands on whatever session the daemon puts a fresh connection on, same
 * as before this existed.
 */
export function rememberSessionForRestore(sessionId: string): void {
  try {
    window.sessionStorage.setItem(RESTORE_SESSION_STORAGE_KEY, sessionId);
  } catch {
    /* storage unavailable — nothing to restore after the reload */
  }
}

function readStoredRestoreId(): string | null {
  try {
    return window.sessionStorage.getItem(RESTORE_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function clearStoredRestoreId(): void {
  try {
    window.sessionStorage.removeItem(RESTORE_SESSION_STORAGE_KEY);
  } catch {
    /* noop — nothing was readable to begin with */
  }
}

/** A wide window starts with the sidebar open; a narrow one keeps the conversation in view. */
function initialSidebarOpen(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(min-width: 768px)').matches;
}

/**
 * #3189 — the host's session list beside the conversation: requests correlated by id (the latest
 * wins), the start/switch commands, and whether the sidebar is shown.
 *
 * A host that keeps sessions live binds each connection to its own session and puts a new connection
 * on its primary one. After a reconnect to such a host this surface goes back to the session it was
 * on; an older host has one session for everyone, so there is nothing to go back to.
 */
export function useSessionDirectoryState(send: (msg: TClientMessage) => void): TSessionDirectoryState & {
  handleSessionsMessage: (msg: TServerMessage) => boolean;
  /** Whether the host can list sessions, as far as its last answer says. */
  canListSessions: () => boolean;
  /** The host made `sessionId` current; show it as current until the fresh list arrives. */
  markCurrent: (sessionId: string) => void;
  /** The connection is (re)established: the next listing decides whether to go back. */
  armRestore: () => void;
} {
  const [sessionListing, setSessionListing] = useState<TSessionListing | null>(null);
  const [sessionsError, setSessionsError] = useState<TSessionsError | null>(null);
  const [sessionSidebarOpen, setSessionSidebarOpen] = useState(initialSidebarOpen);
  const latestRequestRef = useRef<string | null>(null);
  const notAvailableRef = useRef(false);

  const requestSessions = useCallback((): void => {
    const requestId = nextRequestId('sessions');
    latestRequestRef.current = requestId;
    send({ type: 'list-sessions', requestId });
  }, [send]);
  // The host answers a switch to the current session with nothing; asking it would leave the
  // surface waiting for a reply that never comes.
  const currentIdRef = useRef<string | null>(null);
  currentIdRef.current = sessionListing?.currentSessionId ?? null;
  const switchSession = useCallback(
    (sessionId: string): void => {
      if (sessionId === currentIdRef.current) return;
      send({ type: 'switch-session', sessionId, requestId: nextRequestId('session_change') });
    },
    [send],
  );
  const newSession = useCallback(
    (): void => send({ type: 'new-session', requestId: nextRequestId('session_change') }),
    [send],
  );

  // The session this surface last moved to, and — once per connection — whether to go back to it.
  const lastSwitchedIdRef = useRef<string | null>(null);
  const restoreTargetRef = useRef<string | null>(null);
  const armRestore = useCallback((): void => {
    // A remembered id (issue #3280 §5, a desktop Reconnect's reload) wins over the same-page target:
    // on a fresh page, `lastSwitchedIdRef` is always null anyway, so this only ever adds a source.
    restoreTargetRef.current = readStoredRestoreId() ?? lastSwitchedIdRef.current;
  }, []);
  const restoreAfterReconnect = useCallback(
    (listing: TSessionListing): void => {
      const target = restoreTargetRef.current;
      restoreTargetRef.current = null;
      if (target === null) return;
      // Spent on this first listing whether or not the switch below actually happens — a fresh
      // launch with no remembered id never reaches here (target stays null), so nothing switches.
      clearStoredRestoreId();
      if (target === listing.currentSessionId) return;
      if (!keepsSessionsLive(listing)) return;
      // A session the host no longer lists (an empty one it never saved) is nothing to go back to.
      if (!listing.sessions.some((row) => row.id === target)) return;
      send({ type: 'switch-session', sessionId: target, requestId: nextRequestId('session_change') });
    },
    [send],
  );

  const handleSessionsMessage = useCallback(
    (msg: TServerMessage): boolean => {
      if (msg.type !== 'sessions' && msg.type !== 'sessions_error') return false;
      if (msg.requestId !== latestRequestRef.current) return true;
      if (msg.type === 'sessions') {
        notAvailableRef.current = false;
        setSessionListing(msg.listing);
        setSessionsError(null);
        restoreAfterReconnect(msg.listing);
        return true;
      }
      restoreTargetRef.current = null;
      notAvailableRef.current = msg.code === 'not_available';
      if (msg.code === 'not_available') setSessionListing(null);
      setSessionsError({ code: msg.code, message: msg.message });
      return true;
    },
    [restoreAfterReconnect],
  );

  const canListSessions = useCallback((): boolean => !notAvailableRef.current, []);
  const markCurrent = useCallback((sessionId: string): void => {
    lastSwitchedIdRef.current = sessionId;
    setSessionListing((previous) =>
      previous === null ? previous : { ...previous, currentSessionId: sessionId },
    );
  }, []);

  return {
    sessionListing,
    sessionsError,
    requestSessions,
    switchSession,
    newSession,
    sessionSidebarOpen,
    setSessionSidebarOpen,
    handleSessionsMessage,
    canListSessions,
    markCurrent,
    armRestore,
  };
}

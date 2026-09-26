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
function nextRequestId(): string {
  requestCounter += 1;
  return `sessions_${requestCounter}_${Date.now()}`;
}

/** A wide window starts with the sidebar open; a narrow one keeps the conversation in view. */
function initialSidebarOpen(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(min-width: 768px)').matches;
}

/**
 * #3189 — the host's session list beside the conversation: requests correlated by id (the latest
 * wins), the start/switch commands, and whether the sidebar is shown.
 */
export function useSessionDirectoryState(send: (msg: TClientMessage) => void): TSessionDirectoryState & {
  handleSessionsMessage: (msg: TServerMessage) => boolean;
  /** Whether the host can list sessions, as far as its last answer says. */
  canListSessions: () => boolean;
  /** The host made `sessionId` current; show it as current until the fresh list arrives. */
  markCurrent: (sessionId: string) => void;
} {
  const [sessionListing, setSessionListing] = useState<TSessionListing | null>(null);
  const [sessionsError, setSessionsError] = useState<TSessionsError | null>(null);
  const [sessionSidebarOpen, setSessionSidebarOpen] = useState(initialSidebarOpen);
  const latestRequestRef = useRef<string | null>(null);
  const notAvailableRef = useRef(false);

  const requestSessions = useCallback((): void => {
    const requestId = nextRequestId();
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
      send({ type: 'switch-session', sessionId });
    },
    [send],
  );
  const newSession = useCallback((): void => send({ type: 'new-session' }), [send]);

  const handleSessionsMessage = useCallback((msg: TServerMessage): boolean => {
    if (msg.type !== 'sessions' && msg.type !== 'sessions_error') return false;
    if (msg.requestId !== latestRequestRef.current) return true;
    if (msg.type === 'sessions') {
      notAvailableRef.current = false;
      setSessionListing(msg.listing);
      setSessionsError(null);
      return true;
    }
    notAvailableRef.current = msg.code === 'not_available';
    if (msg.code === 'not_available') setSessionListing(null);
    setSessionsError({ code: msg.code, message: msg.message });
    return true;
  }, []);

  const canListSessions = useCallback((): boolean => !notAvailableRef.current, []);
  const markCurrent = useCallback((sessionId: string): void => {
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
  };
}

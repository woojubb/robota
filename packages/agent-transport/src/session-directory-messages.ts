import type { TOutboundDeliver } from './outbound-delivery.js';
import type { TClientMessage } from './wire-messages.js';
import type { ISessionDirectory } from '@robota-sdk/agent-interface-session';

type TSessionDirectoryMessage = Extract<
  TClientMessage,
  { type: 'list-sessions' | 'new-session' | 'switch-session' }
>;

export function isSessionDirectoryMessage(msg: TClientMessage): msg is TSessionDirectoryMessage {
  return (
    msg.type === 'list-sessions' || msg.type === 'new-session' || msg.type === 'switch-session'
  );
}

/**
 * #3189: the host's sessions. Listing answers on its own correlated reply; a new session or a switch
 * answers nothing on success (the host's `session_switched` broadcast is the shared signal) and a
 * `protocol_error` carrying the host's reason when it refuses.
 */
export function handleSessionDirectoryMessage(
  deliver: TOutboundDeliver,
  msg: TSessionDirectoryMessage,
  directory: ISessionDirectory | undefined,
): void {
  if (msg.type === 'list-sessions') {
    listSessions(deliver, msg.requestId, directory);
    return;
  }
  if (!directory) {
    deliver({ type: 'protocol_error', message: 'Sessions cannot be switched on this host.' });
    return;
  }
  const change = (): Promise<void> =>
    msg.type === 'new-session' ? directory.newSession() : directory.switchSession(msg.sessionId);
  void Promise.resolve()
    .then(change)
    .catch((error: Error | string) =>
      deliver({ type: 'protocol_error', message: failureMessage(error) }),
    );
}

function listSessions(
  deliver: TOutboundDeliver,
  requestId: string,
  directory: ISessionDirectory | undefined,
): void {
  if (!directory) {
    deliver({
      type: 'sessions_error',
      requestId,
      code: 'not_available',
      message: 'Session listing is not available on this host.',
    });
    return;
  }
  try {
    deliver({ type: 'sessions', requestId, listing: directory.listSessions() });
  } catch (error) {
    deliver({
      type: 'sessions_error',
      requestId,
      code: 'list_failed',
      message: failureMessage(error instanceof Error ? error : String(error)),
    });
  }
}

function failureMessage(error: Error | string): string {
  return error instanceof Error ? error.message : String(error);
}

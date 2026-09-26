import { isSessionChangeRefusal } from '@robota-sdk/agent-interface-session';

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
 * #3189: the host's sessions. Listing answers on its own correlated reply. A new session or a switch
 * answers nothing on success: `session_switched` from the connection's own session is the signal. A
 * refusal answers `session_change_failed`, carrying the host's code (or `failed` for an error that is
 * not a declared refusal) and the request's `requestId`.
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
  const request = msg.requestId !== undefined ? { requestId: msg.requestId } : {};
  if (!directory) {
    deliver({
      type: 'session_change_failed',
      code: 'not_available',
      message: 'Sessions cannot be switched on this host.',
      ...request,
    });
    return;
  }
  const change = (): Promise<void> =>
    msg.type === 'new-session' ? directory.newSession() : directory.switchSession(msg.sessionId);
  void Promise.resolve()
    .then(change)
    .catch((error: Error | string) =>
      deliver({
        type: 'session_change_failed',
        code: isSessionChangeRefusal(error) ? error.code : 'failed',
        message: failureMessage(error),
        ...request,
      }),
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

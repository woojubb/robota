import { isSessionChangeRefusal, isSessionDeleteRefusal } from '@robota-sdk/agent-interface-session';

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

type TSessionRenameMessage = Extract<TClientMessage, { type: 'rename-session' }>;
type TSessionDeleteMessage = Extract<TClientMessage, { type: 'delete-session' }>;

export function isSessionRenameMessage(msg: TClientMessage): msg is TSessionRenameMessage {
  return msg.type === 'rename-session';
}

export function isSessionDeleteMessage(msg: TClientMessage): msg is TSessionDeleteMessage {
  return msg.type === 'delete-session';
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

/**
 * #3289 §1: rename a session from the list — current or not. Success replies with the new name so
 * the client can update it optimistically; the client also re-lists to pick up everything else a
 * rename can imply (nothing today, but the reply shape matches `delete-session`'s on purpose).
 */
export function handleSessionRenameMessage(
  deliver: TOutboundDeliver,
  msg: TSessionRenameMessage,
  directory: ISessionDirectory | undefined,
): void {
  if (!directory) {
    deliver({
      type: 'session_rename_failed',
      requestId: msg.requestId,
      message: 'Sessions cannot be renamed on this host.',
    });
    return;
  }
  directory.renameSession(msg.sessionId, msg.name).then(
    () =>
      deliver({
        type: 'session_renamed_in_list',
        requestId: msg.requestId,
        sessionId: msg.sessionId,
        name: msg.name,
      }),
    (error: Error | string) =>
      deliver({
        type: 'session_rename_failed',
        requestId: msg.requestId,
        message: failureMessage(error),
      }),
  );
}

/**
 * #3289 §1: remove a stored session's record. Refused when it is live on another client or running a
 * turn; deleting the current session switches this binding away first (the directory's own job), so
 * by the time this answers, the caller's own session is never the one just removed.
 */
export function handleSessionDeleteMessage(
  deliver: TOutboundDeliver,
  msg: TSessionDeleteMessage,
  directory: ISessionDirectory | undefined,
): void {
  if (!directory) {
    deliver({
      type: 'session_delete_failed',
      requestId: msg.requestId,
      code: 'not_available',
      message: 'Sessions cannot be deleted on this host.',
    });
    return;
  }
  directory.deleteSession(msg.sessionId).then(
    () => deliver({ type: 'session_deleted', requestId: msg.requestId, sessionId: msg.sessionId }),
    (error: Error | string) =>
      deliver({
        type: 'session_delete_failed',
        requestId: msg.requestId,
        code: isSessionDeleteRefusal(error) ? error.code : 'failed',
        message: failureMessage(error),
      }),
  );
}

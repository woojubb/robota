/**
 * #3282 §4c — the Project panel's reads (git status, one file's diff, project memory).
 *
 * `TProjectReadCapableSession` is `IProtocolSession & Partial<ISessionProjectRead>` (see
 * `protocol-session.ts`'s doc comment): the three methods are runtime-probed, never assumed, so
 * adding this capability changes nothing for a session or test double that does not have it — a
 * request against one answers `protocol_error` (host-neutral, not a made-up "kind"), the same way an
 * unknown message type already does.
 */
import type { TOutboundDeliver } from './outbound-delivery.js';
import type { TProjectReadCapableSession } from './protocol-session.js';
import type { TClientMessage } from './wire-messages.js';

type TProjectReadMessage = Extract<
  TClientMessage,
  { type: 'project-status' | 'project-diff' | 'project-memory' }
>;

export function isProjectReadMessage(msg: TClientMessage): msg is TProjectReadMessage {
  return msg.type === 'project-status' || msg.type === 'project-diff' || msg.type === 'project-memory';
}

function notSupported(deliver: TOutboundDeliver, requestId: string): void {
  deliver({
    type: 'protocol_error',
    message: 'This host does not support the Project panel.',
    requestId,
  });
}

export function handleProjectReadMessage(
  session: TProjectReadCapableSession,
  deliver: TOutboundDeliver,
  msg: TProjectReadMessage,
): void {
  const { requestId } = msg;
  if (msg.type === 'project-status') {
    if (!session.readProjectStatus) return notSupported(deliver, requestId);
    session.readProjectStatus().then(
      (result) => deliver({ type: 'project_status', requestId, result }),
      (error: unknown) =>
        deliver({
          type: 'project_status',
          requestId,
          result: { kind: 'failed', message: error instanceof Error ? error.message : String(error) },
        }),
    );
  } else if (msg.type === 'project-diff') {
    if (!session.readProjectDiff) return notSupported(deliver, requestId);
    session.readProjectDiff(msg.path).then(
      (result) => deliver({ type: 'project_diff', requestId, result }),
      (error: unknown) =>
        deliver({
          type: 'project_diff',
          requestId,
          result: { kind: 'failed', message: error instanceof Error ? error.message : String(error) },
        }),
    );
  } else {
    if (!session.readProjectMemory) return notSupported(deliver, requestId);
    session.readProjectMemory().then(
      (result) => deliver({ type: 'project_memory', requestId, result }),
      (error: unknown) =>
        deliver({
          type: 'project_memory',
          requestId,
          result: {
            kind: 'unavailable',
            message: error instanceof Error ? error.message : String(error),
          },
        }),
    );
  }
}

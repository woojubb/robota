import type { TOutboundDeliver } from './outbound-delivery.js';
import type { IProtocolSession } from './protocol-session.js';
import type { TClientMessage } from './wire-messages.js';

type TLoopControlMessage = Extract<TClientMessage, { type: 'stop-waiting-loop' }>;

export function isLoopControlMessage(msg: TClientMessage): msg is TLoopControlMessage {
  return msg.type === 'stop-waiting-loop';
}

/**
 * Stop the self-paced loop that is waiting for its next wake. The session decides which loop, if
 * any; the reply carries its outcome, and a session that throws is reported as a failed stop.
 */
export function handleLoopControlMessage(
  session: IProtocolSession,
  deliver: TOutboundDeliver,
  msg: TLoopControlMessage,
): void {
  const { requestId } = msg;
  session.stopWaitingSelfPacedLoop().then(
    (outcome) => deliver({ type: 'waiting_loop_stop', requestId, outcome }),
    (error: unknown) =>
      deliver({
        type: 'waiting_loop_stop',
        requestId,
        outcome: { kind: 'failed', message: errorMessage(error) },
      }),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Ordered `session/update` delivery for one prompt. */

import type { AgentContext, SessionUpdate } from '@agentclientprotocol/sdk';

export interface IAcpUpdateStream {
  send(update: SessionUpdate): void;
  /** Queue message text for the editor. */
  text(text: string): void;
  /** Settles once everything queued has been written or abandoned. Never rejects. */
  drained(): Promise<void>;
}

/**
 * Updates are written in the order they were queued, and a prompt's reply waits on `drained()`, so
 * the editor has every update before it sees `stopReason`. A failed write is reported once and the
 * rest are dropped: the editor is gone, and the session turn is not the carrier's to fail.
 */
export function createUpdateStream(
  client: AgentContext,
  sessionId: string,
  report: (error: Error, context: string) => void,
): IAcpUpdateStream {
  let tail: Promise<void> = Promise.resolve();
  let failed = false;
  const send = (update: SessionUpdate): void => {
    tail = tail.then(async () => {
      if (failed) return;
      try {
        await client.notify('session/update', { sessionId, update });
      } catch (error) {
        failed = true;
        report(error instanceof Error ? error : new Error(String(error)), 'session/update');
      }
    });
  };
  return {
    send,
    text: (text) => send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } }),
    drained: () => tail,
  };
}

import type { TClientMessage, TServerMessage } from '@robota-sdk/agent-transport/client';

/**
 * A terminal's end of the session protocol to a session it is attached to. The terminal only sends
 * and listens; closing the connection belongs to whoever opened it.
 */
export interface IAttachedSessionConnection {
  send(message: TClientMessage): void;
  subscribe(listener: (message: TServerMessage) => void): () => void;
  onClose(listener: () => void): () => void;
}

/** Why an attached terminal stopped showing the session: the user left, or the connection closed. */
export type TAttachedSessionEnd = 'user' | 'closed';

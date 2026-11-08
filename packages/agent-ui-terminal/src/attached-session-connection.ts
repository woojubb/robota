import type { TClientMessage, TServerMessage } from '@robota-sdk/agent-transport/client';
import type { IOwnerSessionDirectory } from '@robota-sdk/agent-interface/session';

/**
 * A terminal's end of the session protocol to a session it is attached to. The terminal only sends
 * and listens; closing the connection belongs to whoever opened it.
 */
export interface IAttachedSessionConnection {
  /** An authenticated owner's decisions, never sent through the ordinary session channel. */
  readonly ownerSessions?: {
    readonly directory: IOwnerSessionDirectory;
    onInvalidate(listener: () => void): () => void;
  };
  send(message: TClientMessage): void;
  subscribe(listener: (message: TServerMessage) => void): () => void;
  onClose(listener: () => void): () => void;
}

/** Why an attached terminal stopped showing the session: the user left, or the connection closed. */
export type TAttachedSessionEnd = 'user' | 'closed';

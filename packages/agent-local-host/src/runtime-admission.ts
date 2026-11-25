/**
 * What a secure runtime's custody gives its control endpoint, and what the endpoint gives it back.
 *
 * The endpoint owns the socket, the request line and the commands answered from the runtime's state;
 * the custody owns who may act as the owner and whether the keys are open. They meet here and
 * nowhere else, so the endpoint never learns what a link proves and the custody never reads a socket.
 * A runtime with no admission is a plain one: every command is open to programs of this user.
 */
import type { Duplex } from 'node:stream';

import type { ILinkBinding } from '@robota-sdk/agent-keyring';

/** What the open `status` says of custody, besides what any runtime says of itself. */
export interface IRuntimeAdmissionStatus {
  /** A spawner installed a trust root, so owner links are possible. */
  readonly certified: boolean;
  /** The owner made this runtime its workspace's daemon. */
  readonly daemon: boolean;
  /** It runs Restricted, without the project's own configuration. */
  readonly restricted: boolean;
}

export interface IRuntimeAdmission {
  /**
   * Serves one owner link on `stream`, which has read the request line and is paused. `rest` is the
   * bytes that arrived with it: the first frame of the handshake, which no text decoding may touch.
   */
  serveLink(stream: Duplex, rest: Buffer): void;
  /** The open `lock` command: it drops read access and needs no proof, since unlocking always does. */
  lock(): void;
  status(): IRuntimeAdmissionStatus;
  /** An owner's request that this runtime be its workspace's daemon; `false` when it cannot be. */
  takeDaemonRole(): boolean;
}

export interface IRuntimeAdmissionContext {
  /** This runtime start: its id and the generation the endpoint minted for it. */
  readonly binding: ILinkBinding;
  /**
   * One command answered from the runtime's own state for an admitted owner, by the handler the
   * plain socket uses: the commands only an owner may send (`rename`, `link-pr`, ...) and the full
   * `status`. Anything else answers `{status: 'refused'}`.
   */
  control(command: string, fields: Readonly<Record<string, string>>): Record<string, unknown>;
}

/** Built once the endpoint knows the generation, which is made inside it. */
export type TRuntimeAdmissionFactory = (context: IRuntimeAdmissionContext) => IRuntimeAdmission;

/**
 * #3189: the session names itself once, after its first turn that ran.
 *
 * Naming used to happen in the in-process terminal, so a session driven by any other client stayed
 * unnamed, and a terminal attached to a served session could not name it. The session owns it now,
 * with the provider it is using when that turn ends (a `/provider switch` before then is honored).
 *
 * Only a turn's own message counts: a remote-control notice is emitted as a `user_message` too, but
 * no `turn_source` precedes it. A turn that failed, or a title that could not be generated, does not
 * use up the naming: the next turn that ends tries again with its own message. Once the session has
 * a name it is never renamed here. A name the session already has (`--name`, a resumed record) is
 * kept, and the name is read again before writing, so a rename made while the title was generated
 * wins.
 */

import { generateSessionName } from './session-naming.js';

import type { IAIProvider } from '@robota-sdk/agent-core';
import type {
  IInteractiveSessionEvents,
  TInteractiveEventName,
} from '@robota-sdk/agent-interface-session';

export interface ISessionAutoNamingPort {
  on<E extends TInteractiveEventName>(event: E, handler: IInteractiveSessionEvents[E]): void;
  getName(): string | undefined;
  setName(name: string): void;
  /** Tell every surface the session was renamed. */
  emitRenamed(name: string): void;
  /** The provider the session sends its turns to now; `undefined` before initialization. */
  getProvider(): IAIProvider | undefined;
}

export class SessionAutoNaming {
  /** A turn started and its own message has not been seen yet. */
  private awaitingTurnMessage = false;
  /** The message of the turn now running, once seen. */
  private turnMessage: string | undefined;
  /** The session has a name: it was given one, or a title was written. */
  private named = false;
  private generating = false;

  constructor(private readonly port: ISessionAutoNamingPort) {
    port.on('turn_source', () => {
      this.turnMessage = undefined;
      this.awaitingTurnMessage = !this.named;
    });
    port.on('user_message', (content) => {
      if (!this.awaitingTurnMessage) return;
      this.awaitingTurnMessage = false;
      this.turnMessage = content;
    });
    port.on('complete', () => this.onTurnRan());
    port.on('interrupted', () => this.onTurnRan());
    // A failed turn ends with `error` and no `complete`: its message is dropped at the next
    // `turn_source`, and that turn tries instead. An `error` reported while a turn still runs
    // (a background failure) leaves that turn's message in place.
    port.on('error', () => {
      this.awaitingTurnMessage = false;
    });
  }

  private onTurnRan(): void {
    const message = this.turnMessage;
    this.turnMessage = undefined;
    if (this.named || this.generating || message === undefined) return;
    if (this.port.getName()) {
      this.named = true;
      return;
    }
    const provider = this.port.getProvider();
    if (provider === undefined) return;
    this.generating = true;
    void generateSessionName(provider, message)
      .then((name) => {
        this.generating = false;
        if (!name) return;
        this.named = true;
        if (this.port.getName()) return;
        this.port.setName(name);
        this.port.emitRenamed(name);
      })
      // allow-fallback: a title is a convenience; a failed generation leaves the session unnamed
      // until the next turn tries again.
      .catch(() => {
        this.generating = false;
      });
  }
}

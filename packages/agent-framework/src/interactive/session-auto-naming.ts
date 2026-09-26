/**
 * #3189: the session names itself once, after its first turn.
 *
 * Naming used to happen in the in-process terminal, so a session driven by any other client stayed
 * unnamed, and a terminal attached to a served session could not name it. The session owns it now,
 * with the provider it is using when that turn ends (a `/provider switch` before then is honored).
 *
 * Only a turn's own message counts: a remote-control notice is emitted as a `user_message` too, but
 * no `turn_source` precedes it. A name the session already has (`--name`, a resumed record) is kept,
 * and the name is read again before writing, so a rename made while the title was generated wins.
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
  private firstMessage: string | undefined;
  private attempted = false;

  constructor(private readonly port: ISessionAutoNamingPort) {
    port.on('turn_source', () => {
      if (!this.attempted && this.firstMessage === undefined) this.awaitingTurnMessage = true;
    });
    port.on('user_message', (content) => {
      if (!this.awaitingTurnMessage) return;
      this.awaitingTurnMessage = false;
      this.firstMessage = content;
    });
    port.on('complete', () => this.onTurnEnded());
    port.on('interrupted', () => this.onTurnEnded());
    port.on('error', () => this.onTurnEnded());
  }

  private onTurnEnded(): void {
    const firstMessage = this.firstMessage;
    if (this.attempted || firstMessage === undefined) return;
    this.attempted = true;
    this.firstMessage = undefined;
    if (this.port.getName()) return;
    const provider = this.port.getProvider();
    if (provider === undefined) return;
    void generateSessionName(provider, firstMessage)
      .then((name) => {
        if (!name || this.port.getName()) return;
        this.port.setName(name);
        this.port.emitRenamed(name);
      })
      // allow-fallback: a title is a convenience; a failed attempt leaves the session unnamed.
      .catch(() => undefined);
  }
}

/**
 * RUNTIME-003 — a submission that was accepted and then never ran.
 *
 * Typed rather than a bare `Error` because the caller has to act on the reason: 'coalesced' means
 * the caller's own newer input superseded it and is normal, while 'dropped' means the queue was full
 * and the input is gone. A consumer forced to regex-match a message to tell those apart still has
 * the string-matching this change exists to remove.
 *
 * The SHAPE is a contract (`ITurnNotRunError` in `@robota-sdk/agent-interface-session`); the class
 * lives here, beside the code that throws it, because an interface package is inert by rule — a
 * class declaration in it is a runtime construct the contract must not carry.
 */

import type { ITurnNotRunError, TTurnNotRunReason } from '@robota-sdk/agent-interface-session';

export class TurnNotRunError extends Error implements ITurnNotRunError {
  override readonly name = 'TurnNotRunError' as const;
  constructor(
    readonly turnId: string,
    readonly reason: TTurnNotRunReason,
  ) {
    super(`turn ${turnId} never ran: ${reason}`);
  }
}

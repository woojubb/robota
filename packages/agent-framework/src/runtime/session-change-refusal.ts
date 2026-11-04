/**
 * #3189 — a session change the host declined, with a code the client can branch on.
 *
 * The SHAPE is a contract (`ISessionChangeRefusal` in `@robota-sdk/agent-interface-session`); the
 * class lives here, beside the code that throws it, because an interface package is inert by rule.
 */

import { isSessionClaimedError } from '@robota-sdk/agent-session';

import type { SessionClaimedError } from '@robota-sdk/agent-session';
import type {
  ISessionChangeRefusal,
  ISessionDeleteRefusal,
  TSessionChangeRefusalCode,
  TSessionDeleteRefusalCode,
} from '@robota-sdk/agent-interface-session';

export type { TSessionChangeRefusalCode, TSessionDeleteRefusalCode };

/**
 * What a client is told when the session it asked for cannot start because a session of that id in
 * this process still holds its record — one that is shutting down. Fixed, so a client may show it.
 */
export const SESSION_STILL_CLOSING_MESSAGE = 'The session is still closing; try again.';

/**
 * What a client is told when the store refused to claim the session it asked for: still closing, for
 * a writer in this process, or else the store's own words, which name the process that holds it.
 */
export function claimedSessionMessage(error: SessionClaimedError): string {
  return error.holder?.self === true ? SESSION_STILL_CLOSING_MESSAGE : error.message;
}

/**
 * The words for `error` when it is the store refusing to claim a session, for a host that ends its
 * start on them instead of showing the error; `undefined` for any other error, which stays the
 * caller's.
 */
export function claimRefusalMessage(error: unknown): string | undefined {
  return isSessionClaimedError(error) ? claimedSessionMessage(error) : undefined;
}

export class SessionChangeRefusal extends Error implements ISessionChangeRefusal {
  override readonly name = 'SessionChangeRefusal' as const;
  constructor(
    readonly code: TSessionChangeRefusalCode,
    message: string,
  ) {
    super(message);
  }
}

/** #3289 §1 — a session delete the host declined, with a code the client can branch on. */
export class SessionDeleteRefusal extends Error implements ISessionDeleteRefusal {
  override readonly name = 'SessionDeleteRefusal' as const;
  constructor(
    readonly code: TSessionDeleteRefusalCode,
    message: string,
  ) {
    super(message);
  }
}

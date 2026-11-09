/**
 * A session change the host declined, with a code the client can branch on.
 *
 * The SHAPE is a contract (`ISessionChangeRefusal` in `@robota-sdk/agent-interface/session`); the
 * class lives here, beside the code that throws it, because an interface package is inert by rule.
 */

import { isSessionClaimedError } from '@robota-sdk/agent-session';

import type { SessionClaimedError } from '@robota-sdk/agent-session';
import type {
  ISessionChangeRefusal,
  ISessionDeleteRefusal,
  TSessionChangeRefusalCode,
  TSessionDeleteRefusalCode,
} from '@robota-sdk/agent-interface/session';

export type { TSessionChangeRefusalCode, TSessionDeleteRefusalCode };

/**
 * What a client is told when the session it asked for cannot start because a session of that id in
 * this process has not let its claim go — one that is shutting down. Fixed, so a client may show it.
 */
export const SESSION_STILL_CLOSING_MESSAGE = 'The session is still closing; try again.';

/**
 * What a client is told when the store refused to claim the session it asked for: still closing, for
 * a session of this process that has not let its claim go, or else the store's own words, which name
 * who holds it: another process, or the subagent a fork's record is lent to.
 */
export function claimedSessionMessage(error: SessionClaimedError): string {
  return error.closing ? SESSION_STILL_CLOSING_MESSAGE : error.message;
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

/** A session delete the host declined, with a code the client can branch on. */
export class SessionDeleteRefusal extends Error implements ISessionDeleteRefusal {
  override readonly name = 'SessionDeleteRefusal' as const;
  constructor(
    readonly code: TSessionDeleteRefusalCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The change refusal a client is given when the store refused a session's claim or write, or
 * `undefined` for any other error. A session of that id in this process that is shutting down is the
 * one writer a client can wait out, so it is `still_closing`; any other holder runs on and is
 * `has_writer`, named in the store's words.
 */
export function claimChangeRefusal(error: unknown): SessionChangeRefusal | undefined {
  if (!isSessionClaimedError(error)) return undefined;
  return new SessionChangeRefusal(
    error.closing ? 'still_closing' : 'has_writer',
    claimedSessionMessage(error),
  );
}

/**
 * {@link claimChangeRefusal} for a delete: the session still closing here is `running`, the nearest
 * delete code, since a delete has no `still_closing`.
 */
export function claimDeleteRefusal(error: unknown): SessionDeleteRefusal | undefined {
  const refusal = claimChangeRefusal(error);
  if (refusal === undefined) return undefined;
  return new SessionDeleteRefusal(
    refusal.code === 'still_closing' ? 'running' : 'has_writer',
    refusal.message,
  );
}

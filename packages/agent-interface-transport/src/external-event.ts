/**
 * Who may put an event from outside into a running session, decided from an access token.
 *
 * An external sender is identified only by a bearer access token the host verifies itself with an
 * `IAccessTokenVerifier`. Whatever carries the event — an HTTP request, an MCP notification, a local
 * bridge — only moves the token and the event, and nothing it or the event says about the sender is
 * identity. The grant is the principal: it pins exactly one subject or client, so every admitted
 * event is attributed to the grant, never to a name inside the payload.
 *
 * Like `access-token.ts`, this speaks the `admission.ts` vocabulary: secure by default, and a refusal
 * says why in a stable word. Refusals and audit records never carry the token, a claim value, the
 * event content, the conversation id or the peer's address.
 */

import type { IAccessTokenVerifierConfig, TAccessTokenRefusal } from './access-token.js';

/** One sliding window of the per-grant turn rate. */
export interface IExternalEventRateWindow {
  readonly windowMs: number;
  readonly maxTurns: number;
}

/**
 * The owner's standing decision that one principal may submit restricted turns to one session.
 *
 * `verifier` must name exactly one principal: one entry in `allowedSubjects` or in `allowedClients`,
 * and none in the other. A grant naming more would let one label speak for several parties.
 */
export interface IExternalEventGrant {
  /** Operator-chosen label, `[a-zA-Z0-9_-]{1,64}`; the attribution every admitted event carries. */
  readonly grantId: string;
  readonly verifier: IAccessTokenVerifierConfig;
  /** Event kinds this grant admits. */
  readonly kinds: readonly ['message'];
  /** Turn-rate windows for this grant; the host applies its defaults when absent. */
  readonly rate?: readonly IExternalEventRateWindow[];
}

/** A message event as a carrier delivers it. `claimedName` is shown as claimed and never trusted. */
export interface IExternalMessageEvent {
  readonly kind: 'message';
  readonly conversationId: string;
  readonly content: string;
  readonly claimedName?: string;
}

/** What a carrier hands the host: the bearer token as presented, and the event as received. */
export interface IExternalEventDelivery {
  readonly token: string | undefined;
  /** Validated by the host; a carrier does not vouch for its shape. */
  readonly event: unknown;
}

/**
 * Why an external event was refused: a token refusal from the verifier, or one of these.
 *
 * - `missing-token` — no bearer token was presented.
 * - `unknown-grant` — the carrier addressed a grant the session does not hold.
 * - `grant-revoked` — the owner revoked the grant.
 * - `source-closed` — the grant's source is closed.
 * - `malformed-event` — the event is not a well-formed event of a kind the grant admits.
 * - `oversize` — the event content, or the token, exceeds its bound.
 * - `rate-limited` — the grant is over one of its turn-rate windows.
 * - `queue-full` — the session cannot hold another pending turn.
 * - `shutting-down` — the session no longer takes turns.
 * - `session-unavailable` — the session could not take the turn for another reason.
 *
 * A token already spent on an admitted event is refused as `malformed`, like a token that does not
 * name itself with a `jti`.
 */
export type TExternalEventRefusal =
  | TAccessTokenRefusal
  | 'missing-token'
  | 'unknown-grant'
  | 'grant-revoked'
  | 'source-closed'
  | 'malformed-event'
  | 'oversize'
  | 'rate-limited'
  | 'queue-full'
  | 'shutting-down'
  | 'session-unavailable';

/** The receipt for one delivery. An admission names the turn and nothing the turn produced. */
export type TExternalEventAdmission =
  | { readonly admitted: true; readonly turnId: string }
  | { readonly admitted: false; readonly refusal: TExternalEventRefusal };

/** How an admitted event's turn ended. */
export type TExternalEventSettlementOutcome = 'completed' | 'interrupted' | 'not-run' | 'failed';

/** The coarse class of the peer's address, the only thing an audit record says about where it was. */
export type TExternalEventRemoteClass = 'loopback' | 'private' | 'public' | 'unknown';

interface IExternalEventAuditBase {
  /** ISO 8601 time of the decision. */
  readonly at: string;
  /** Absent when the refusal came before a grant was identified. */
  readonly grantId?: string;
  /** Set by a carrier that knows the peer's address. */
  readonly remote?: TExternalEventRemoteClass;
  /** Set by a carrier whose failure throttle refused the peer. */
  readonly throttled?: boolean;
}

/** One record per refusal and per settlement. It carries no content and nothing that identifies a person. */
export type TExternalEventAuditRecord =
  | (IExternalEventAuditBase & { readonly refusal: TExternalEventRefusal })
  | (IExternalEventAuditBase & { readonly settlement: TExternalEventSettlementOutcome });

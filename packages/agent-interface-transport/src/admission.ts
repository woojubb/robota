/**
 * SEC-008 — who is allowed to reach a session, decided once instead of per transport.
 *
 * ## The defect this replaces
 *
 * Admission was not a member of any contract, so each transport re-decided it and they did not
 * agree. Two sibling transports made OPPOSITE default choices for one question: the WS transport
 * auto-mints a token unless told to stay open, while the WebRTC transport's secret was optional and
 * absent by default. The HTTP transport had no gate at all — an unauthenticated `POST /submit`
 * reached the session and ran the prompt, and looked identical to an authorised one.
 *
 * A convention each implementation may or may not follow is not a trust boundary. The policy layer
 * above assumed a boundary existed and had no way to require one.
 *
 * ## What this module decides
 *
 * The TYPES only. An interface package is inert by rule — no runtime dependency edges, no classes —
 * and the minting and comparison need `node:crypto`, so they live in `@robota-sdk/agent-transport-protocol`
 * beside the transports that call them. The shape of the decision is declared here because it is a
 * contract; the machinery that produces it is not.
 *
 * `resolveAdmission` answers "what credential does this transport require?" the same way for every
 * caller, and the answer is SECURE BY DEFAULT: an explicit token wins; otherwise one is minted. A
 * transport can still be open, but only by saying so — `open: true` with a written reason. The
 * reason is required because "no credential" and "nobody thought about it" were indistinguishable in
 * the code this replaces, and the whole point is to make the second one impossible to write.
 *
 * Failing to mint THROWS rather than returning an open admission. A transport that cannot get
 * entropy must fail to construct, not bind without a gate — the direction a security default has to
 * fail in.
 */

/**
 * What a transport requires of a peer before it may reach the session.
 *
 * `token: null` is not "unset" — it is the recorded outcome of an explicit decision to run open,
 * and `openReason` says who made it and why. There is no third state, which is the property that
 * makes a parity check over transports possible at all.
 */
export interface ITransportAdmission {
  /** The credential a peer must present, or `null` when this transport was explicitly opened. */
  readonly token: string | null;
  /** Why it is open. Present exactly when `token` is null. */
  readonly openReason?: string;
}

/** How a caller asks for an admission decision. */
export interface ITransportAdmissionConfig {
  /** A credential chosen by the host (e.g. read from config or handed to a spawned child). */
  readonly token?: string;
  /** Run with NO credential. Requires `openReason`. */
  readonly open?: boolean;
  /** Why running open is correct here. Required when `open` is true. */
  readonly openReason?: string;
}

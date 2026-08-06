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

import { randomBytes, timingSafeEqual } from 'node:crypto';

/** Bytes of entropy per minted token. 32 bytes = 256 bits, hex-encoded to 64 characters. */
const TOKEN_BYTES = 32;

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

/**
 * Mint a per-launch credential.
 *
 * Throws rather than returning a short or empty string if entropy is unavailable, so a transport
 * built on it fails to construct instead of binding with a guessable credential.
 */
export function mintTransportToken(): string {
  const token = randomBytes(TOKEN_BYTES).toString('hex');
  if (token.length !== TOKEN_BYTES * 2) {
    throw new Error('transport admission: could not mint a credential of the required length');
  }
  return token;
}

/**
 * Resolve the admission decision for one transport.
 *
 * @throws if `open` is set without a reason — an unexplained open transport is the state this
 * module exists to remove, so it is refused at construction rather than recorded and shipped.
 */
export function resolveAdmission(config: ITransportAdmissionConfig = {}): ITransportAdmission {
  if (config.token !== undefined && config.token !== '') {
    return { token: config.token };
  }
  if (config.open === true) {
    const reason = config.openReason?.trim();
    if (!reason) {
      throw new Error(
        'transport admission: `open: true` requires `openReason`. An open transport is a decision, ' +
          'and a decision nobody wrote down is indistinguishable from an oversight.',
      );
    }
    return { token: null, openReason: reason };
  }
  return { token: mintTransportToken() };
}

/**
 * Whether a presented credential matches the required one.
 *
 * Compared with `timingSafeEqual` over the raw bytes, so the answer takes the same time whatever the
 * first differing character is. The length check before it is not a leak worth avoiding — the token
 * length is fixed and public — but `timingSafeEqual` throws on unequal lengths, so it has to happen.
 *
 * A missing credential is a mismatch, not a special case: a peer that sends nothing and a peer that
 * sends the wrong thing are equally unadmitted, and giving them different answers would tell an
 * attacker which half they got right.
 */
export function credentialMatches(expected: string, presented: string | undefined): boolean {
  if (presented === undefined) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(presented, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Extract a bearer credential from an `Authorization` header value.
 *
 * Returns `undefined` for anything that is not exactly a bearer token, including a header that
 * merely starts with the right word — a peer sending `Bearerness xyz` is sending something else.
 */
export function bearerCredential(header: string | undefined | null): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer (.+)$/.exec(header);
  return match?.[1];
}

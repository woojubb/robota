/**
 * SEC-008 — the machinery behind the admission decision.
 *
 * The SHAPE of the decision is a contract and lives in `@robota-sdk/agent-interface-transport`; an
 * interface package is inert by rule, and minting and comparing a credential need `node:crypto`. So
 * the types are declared there and produced here, in the package every transport already shares.
 *
 * Splitting them is not bookkeeping. Putting the crypto in the contract package would have given
 * every consumer of those types a runtime dependency edge on a Node builtin — the same defect
 * CORE-028 removed from another package, reintroduced one package over.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';

import type {
  ITransportAdmission,
  ITransportAdmissionConfig,
} from '@robota-sdk/agent-interface-transport';

/** Bytes of entropy per minted token. 32 bytes = 256 bits, hex-encoded to 64 characters. */
const TOKEN_BYTES = 32;

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
 * IDEMPOTENT: it accepts an already-resolved `ITransportAdmission` and returns it unchanged, so
 * `resolve(resolve(x))` is `resolve(x)`. That is not a convenience — it is what lets a caller
 * holding either shape just call this, instead of deciding which shape it holds first.
 *
 * The HTTP route used to make that decision with `'token' in options.admission`, and review showed
 * it cannot work: BOTH interfaces declare a `token`, so a config is only distinguishable from a
 * resolution by the VALUE. `{ token: '' }` — documented as "mint a fresh one" — was read as
 * pre-resolved and installed the empty string as the required credential, which a peer sending an
 * empty bearer would then match. Making this function idempotent deletes that discriminator
 * instead of repairing it.
 *
 * @throws if `open` is set without a reason — an unexplained open transport is the state this
 * module exists to remove, so it is refused at construction rather than recorded and shipped.
 * @throws if a token and `open: true` are asked for together. The two are contradictory, and the
 * silent precedence this used to give (token wins) is the safe DIRECTION but the wrong ANSWER: a
 * caller that wrote both does not know what it is asking for, and one of the two things it believes
 * is false. `WebRtcTransport` already refused the analogous `secret` + `open` pair in its own
 * constructor; a seam whose whole claim is "one place to read and one place to change" cannot leave
 * that protection to whichever transport happens to have implemented it.
 */
export function resolveAdmission(
  config: ITransportAdmissionConfig | ITransportAdmission = {},
): ITransportAdmission {
  const requestedOpen = 'open' in config && config.open === true;
  const hasToken = config.token !== undefined && config.token !== null && config.token !== '';

  if (hasToken && requestedOpen) {
    throw new Error(
      'transport admission: a token and `open: true` are contradictory — one requires a credential ' +
        'and the other requires none. Asking for both means one of the two beliefs behind the call ' +
        'is wrong; say which is intended.',
    );
  }

  if (hasToken) {
    return { token: config.token as string };
  }

  // `token: null` is the RESOLVED open state, not an absent token — the one value that tells an
  // already-resolved admission apart from a config. It still has to carry its reason: an
  // admission reaching this function without one was either built by hand or corrupted, and both
  // are the unexplained-open state the reason exists to prevent.
  if (config.token === null || requestedOpen) {
    const reason = config.openReason?.trim();
    if (!reason) {
      throw new Error(
        'transport admission: an open transport requires `openReason`. An open transport is a ' +
          'decision, and a decision nobody wrote down is indistinguishable from an oversight.',
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
 * first differing character is. The length check before it is unavoidable — `timingSafeEqual` throws
 * on unequal lengths — and it does leak one bit: whether the presented credential is the right
 * LENGTH.
 *
 * For a minted token that costs nothing: the length is fixed at 64 hex characters and published in
 * this file. A host that supplies its own token of some other length leaks that length instead, and
 * review was right to point out that the earlier wording ("fixed and public") quietly assumed the
 * minted case for every case. Length is not the secret in either — but the claim now says which
 * situation it is describing.
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
 * Returns `undefined` for anything that is not a bearer token, including a header that merely
 * starts with the right word — a peer sending `Bearerness xyz` is sending something else.
 *
 * The SCHEME is matched case-insensitively, per RFC 7235: `auth-scheme` is a token and tokens are
 * compared without regard to case, so `bearer …` and `BEARER …` are the same request. Review found
 * the exact-case match; it failed safe, refusing a conformant client with a 401 it could not act on,
 * which is the kind of refusal that gets read as a server bug and worked around rather than fixed.
 * The credential itself is untouched — it is not a token in that sense and its case is significant.
 *
 * Separator: one or more spaces or tabs, not exactly one space. That is the same clause's `BWS`.
 */
export function bearerCredential(header: string | undefined | null): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer[ \t]+(.+)$/i.exec(header);
  return match?.[1];
}

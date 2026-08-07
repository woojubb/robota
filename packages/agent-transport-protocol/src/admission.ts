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

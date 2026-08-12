/**
 * Connection-admission guards for the WS transport (SEC-001 / GUI-002).
 *
 * Pure, socket-free predicates over the HTTP upgrade request — token minting/comparison plus the
 * `Host` and `Origin` allow-lists. Split out of `ws-transport-configurable.ts` so the transport file
 * carries lifecycle and frame routing only; the admission policy is independently readable and the
 * transport module stays within the file-size ratchet.
 */

import { timingSafeEqual } from 'node:crypto';

import { resolveAdmission } from '@robota-sdk/agent-transport-protocol';

import type { ITransportAdmission } from '@robota-sdk/agent-interface-transport';
import type { IncomingMessage } from 'node:http';

/**
 * Host names that are always loopback (port stripped by the caller). IPv4 bind only, so `[::1]`
 * inbound is moot, but accepting it is harmless.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Strip the `:port` suffix from a Host/authority (port-agnostic — `bindWithRetry` can walk the port). */
function hostname(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  if (hostHeader.startsWith('[')) return hostHeader.slice(0, hostHeader.indexOf(']') + 1) || null;
  const colon = hostHeader.lastIndexOf(':');
  return colon === -1 ? hostHeader : hostHeader.slice(0, colon);
}

/**
 * The upgrade `Host` must be a loopback name (port-agnostic) or an explicitly allowed host — closes
 * DNS rebinding. A missing `Host` is rejected (a well-formed HTTP/1.1 client always sends one).
 */
export function hostAllowed(req: IncomingMessage, allowedHosts: ReadonlySet<string>): boolean {
  const host = hostname(req.headers.host);
  if (host === null) return false;
  return LOOPBACK_HOSTS.has(host) || allowedHosts.has(host);
}

/**
 * A browser sends an unforgeable `Origin`; require it to be loopback or explicitly allowed. A
 * non-browser client omits `Origin` (allowed here — the token is its gate). Closes the browser
 * drive-by hole.
 */
export function originAllowed(req: IncomingMessage, allowedOrigins: ReadonlySet<string>): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true; // non-browser client; token still required
  if (allowedOrigins.has(origin)) return true;
  try {
    return LOOPBACK_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false; // malformed Origin → reject
  }
}

/**
 * Constant-time token comparison. Returns false on any length mismatch (never throws), so an
 * absent/short/long presented token is a plain reject, not an error.
 */
export function tokenMatches(expected: string, presented: string | null | undefined): boolean {
  if (!presented) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Read the presented token from the upgrade request: `?token=` query param, else the WS subprotocol. */
export function presentedToken(req: IncomingMessage): string | null {
  try {
    const url = new URL(req.url ?? '', 'ws://127.0.0.1');
    const q = url.searchParams.get('token');
    if (q) return q;
  } catch {
    // malformed URL → fall through to the subprotocol header
  }
  const proto = req.headers['sec-websocket-protocol'];
  return typeof proto === 'string' ? proto.split(',')[0]?.trim() || null : null;
}

/**
 * This transport's admission decision, asked of the shared seam.
 *
 * Lives here rather than in the transport file because this module already owns the admission
 * policy — token comparison and the Host/Origin allow-lists — and the transport file carries
 * lifecycle and frame routing. The split is also what keeps that file inside its size ratchet.
 */
export function resolveWsAdmission(config: {
  token?: string;
  open?: boolean;
  openReason?: string;
}): ITransportAdmission {
  // No fabricated reason. The first version filled one in for any caller that omitted it, which made
  // WS the one transport where `{ open: true }` alone was accepted — HTTP and WebRTC both refuse it.
  // Review found that: a reason invented on the caller's behalf reads, to the next person, as a
  // decision somebody made. The whole point of requiring it is that nobody can produce one by
  // accident, so the seam is asked the question exactly as it was given.
  return resolveAdmission({
    ...(config.token !== undefined ? { token: config.token } : {}),
    ...(config.open === true ? { open: true } : {}),
    ...(config.openReason !== undefined ? { openReason: config.openReason } : {}),
  });
}

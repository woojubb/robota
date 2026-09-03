/**
 * The shared outbound-network (egress) boundary (#2026).
 *
 * Every built-in, provider helper and node runtime that fetches a caller- or model-supplied URL goes
 * through {@link fetchWithEgressPolicy}. It owns, in one place:
 *
 * - DESTINATION safety: only `http:`/`https:`; literal and RESOLVED addresses are refused when they are
 *   loopback, private, link-local, multicast, unspecified or reserved — for IPv4, IPv6, and IPv4-mapped /
 *   NAT64-embedded forms — plus the well-known cloud metadata hostnames. `URL` normalization is what
 *   collapses alternate encodings (`2130706433`, `0x7f.1`, `[::ffff:7f00:1]`) into one hostname.
 * - REDIRECTS: followed manually, every hop re-validated, and caller-supplied plus credential-bearing
 *   headers dropped on a cross-origin hop.
 * - RESOURCE policy: the caller's `AbortSignal` composed with an explicit deadline, and the response
 *   byte cap enforced WHILE STREAMING (and from `Content-Length` first), never after a whole-body
 *   allocation.
 * - ESCAPE HATCHES: `allowedHosts` (exact hostnames that may resolve privately) and
 *   `allowPrivateAddresses` (an explicit enterprise opt-out), both declared by the composition root.
 *
 * What it does NOT yet do: pin the connection to the validated address (Node's global `fetch` exposes
 * no connect-time lookup hook without the `undici` package). Resolve-then-validate on every hop narrows
 * the DNS-rebinding window; it does not close it, and this comment is the record of that gap.
 *
 * Node-only (`node:dns`, `node:net`): exported from `@robota-sdk/agent-core/node`, never the browser barrel.
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type TEgressLookup = (hostname: string) => Promise<readonly string[]>;

export interface IEgressPolicy {
  /** Exact lowercase hostnames that may be reached even when they resolve to a private address. */
  readonly allowedHosts?: readonly string[];
  /** Explicit enterprise opt-out from private/loopback/metadata blocking. Default `false`. */
  readonly allowPrivateAddresses?: boolean;
  /** Redirect hops followed before refusing. Default 5. */
  readonly maxRedirects?: number;
}

export interface IEgressFetchOptions {
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  /** Deadline for the WHOLE exchange, redirects and body included. Default 30 000 ms. */
  readonly timeoutMs?: number;
  /** Byte cap enforced on `Content-Length` and again while streaming. Default 5 000 000. */
  readonly maxResponseBytes?: number;
}

export interface IEgressDeps {
  readonly fetch?: typeof globalThis.fetch;
  readonly lookup?: TEgressLookup;
}

export type TEgressRejectionReason =
  | 'unsupported_scheme'
  | 'private_destination'
  | 'metadata_host'
  | 'unresolvable'
  | 'redirect_limit'
  | 'redirect_without_location'
  | 'response_too_large';

export interface IEgressRejection {
  readonly reason: TEgressRejectionReason;
  readonly url: string;
  readonly message: string;
}

export type TEgressFetchResult =
  | {
      ok: true;
      status: number;
      statusText: string;
      headers: Headers;
      body: Uint8Array;
      finalUrl: string;
    }
  | { ok: false; rejection: IEgressRejection };

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5_000_000;
const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Hostnames that are metadata services or loopback by convention, whatever they resolve to. */
export const BLOCKED_HOSTNAMES: ReadonlySet<string> = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'instance-data.ec2.internal',
]);

/** True when `ip` (v4 or v6 text) is not a public unicast address. */
export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIpv4(ip.split('.').map(Number));
  if (version === 6) return isPrivateIpv6(ip);
  return true; // not an address at all: never treat it as public
}

function isPrivateIpv4(o: readonly number[]): boolean {
  const [a = 0, b = 0, c = 0] = o;
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, incl. 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast + reserved + broadcast
  );
}

function isPrivateIpv6(ip: string): boolean {
  const groups = expandIpv6(ip);
  if (groups === undefined) return true;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  const isMapped = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff;
  const isNat64 = g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0;
  if (isMapped || isNat64) {
    return isPrivateIpv4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]);
  }
  const allZero = groups.every((g) => g === 0);
  if (allZero) return true; // ::
  if (groups.slice(0, 7).every((g) => g === 0) && g7 === 1) return true; // ::1
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated, still routable)
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/** Expand an IPv6 literal (as `URL` normalizes it, brackets removed) into 8 16-bit groups. */
function expandIpv6(ip: string): number[] | undefined {
  const withoutZone = ip.split('%')[0] ?? ip;
  const halves = withoutZone.split('::');
  if (halves.length > 2) return undefined;
  const parse = (part: string): number[] =>
    part.length === 0 ? [] : part.split(':').map((g) => Number.parseInt(g, 16));
  const head = parse(halves[0] ?? '');
  const tail = halves.length === 2 ? parse(halves[1] ?? '') : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return undefined;
  const groups = [...head, ...new Array<number>(missing).fill(0), ...tail];
  return groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff) ? undefined : groups;
}

const defaultLookup: TEgressLookup = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

/** Validate ONE destination URL against the policy. `undefined` means it may be reached. */
export async function rejectDestination(
  url: URL,
  policy: IEgressPolicy = {},
  lookup: TEgressLookup = defaultLookup,
): Promise<IEgressRejection | undefined> {
  const href = url.href;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      reason: 'unsupported_scheme',
      url: href,
      message: `Only http(s) URLs may be fetched.`,
    };
  }
  if (policy.allowPrivateAddresses === true) return undefined;
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (policy.allowedHosts?.includes(hostname)) return undefined;
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
    return {
      reason: 'metadata_host',
      url: href,
      message: `Destination "${hostname}" is a loopback or cloud-metadata host and is not reachable from tools.`,
    };
  }
  const addresses = isIP(hostname) ? [hostname] : await resolve(hostname, lookup);
  if (addresses === undefined || addresses.length === 0) {
    return {
      reason: 'unresolvable',
      url: href,
      message: `Destination "${hostname}" did not resolve.`,
    };
  }
  const blocked = addresses.find(isPrivateAddress);
  if (blocked !== undefined) {
    return {
      reason: 'private_destination',
      url: href,
      message: `Destination "${hostname}" resolves to ${blocked}, a private, loopback or link-local address, and is not reachable from tools.`,
    };
  }
  return undefined;
}

async function resolve(
  hostname: string,
  lookup: TEgressLookup,
): Promise<readonly string[] | undefined> {
  try {
    return await lookup(hostname);
  } catch {
    // allow-fallback: an unresolvable host is a POLICY outcome ("unresolvable"), reported to the
    // caller as a rejection with its reason — not a hidden success.
    return undefined;
  }
}

/**
 * Fetch `url` under the egress policy. Policy outcomes are RETURNED (`ok: false`); transport errors
 * (DNS failure at connect, refused connection, TLS, abort) are THROWN, as `fetch` throws them, so the
 * caller's own error classification keeps working.
 */
export async function fetchWithEgressPolicy(
  url: string,
  options: IEgressFetchOptions = {},
  policy: IEgressPolicy = {},
  deps: IEgressDeps = {},
): Promise<TEgressFetchResult> {
  const doFetch = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const lookup = deps.lookup ?? defaultLookup;
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const maxRedirects = policy.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const deadline = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;

  let current = new URL(url);
  let headers: Record<string, string> = { ...(options.headers ?? {}) };
  for (let hop = 0; ; hop += 1) {
    const rejection = await rejectDestination(current, policy, lookup);
    if (rejection !== undefined) return { ok: false, rejection };

    const response = await doFetch(current.href, { headers, signal, redirect: 'manual' });
    if (!REDIRECT_STATUSES.has(response.status)) {
      return readUnderCap(response, current.href, maxBytes, signal);
    }
    const location = response.headers.get('location');
    if (location === null) {
      return {
        ok: false,
        rejection: {
          reason: 'redirect_without_location',
          url: current.href,
          message: `HTTP ${response.status} without a Location header.`,
        },
      };
    }
    if (hop >= maxRedirects) {
      return {
        ok: false,
        rejection: {
          reason: 'redirect_limit',
          url: current.href,
          message: `More than ${maxRedirects} redirects.`,
        },
      };
    }
    const next = new URL(location, current);
    if (next.origin !== current.origin) headers = stripSensitiveHeaders(headers);
    current = next;
  }
}

/** On a cross-origin hop nothing the caller supplied travels on — only the identifying User-Agent. */
function stripSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'user-agent') kept[name] = value;
  }
  return kept;
}

async function readUnderCap(
  response: Response,
  finalUrl: string,
  maxBytes: number,
  signal: AbortSignal,
): Promise<TEgressFetchResult> {
  const tooLarge = (seen: number): TEgressFetchResult => ({
    ok: false,
    rejection: {
      reason: 'response_too_large',
      url: finalUrl,
      message: `Response exceeds ${maxBytes} bytes (${seen} seen).`,
    },
  });
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    return tooLarge(declared);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (!response.body && typeof response.arrayBuffer === 'function') {
    // A carrier with no readable stream (a body-less Response, or a non-streaming fetch
    // implementation) can only be read whole; the cap is then checked on what it handed over.
    const whole = new Uint8Array(await response.arrayBuffer());
    if (whole.byteLength > maxBytes) return tooLarge(whole.byteLength);
    chunks.push(whole);
    total = whole.byteLength;
  } else if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return tooLarge(total);
      }
      chunks.push(value);
    }
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    ok: true,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    body,
    finalUrl,
  };
}

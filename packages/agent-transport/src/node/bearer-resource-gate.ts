/**
 * The shared admission gate of an OAuth resource server reached over HTTP: RFC 6750 bearer challenges,
 * RFC 9728 protected-resource metadata, the public-URL name checks, and a failure-only throttle per
 * peer address. Every remote HTTP carrier that admits by access token composes these pieces, so the
 * rules are one set of code rather than one per carrier.
 *
 * The host is reached through its PUBLIC URL, usually behind a reverse proxy, so every name the gate
 * checks comes from that URL rather than from the listener: the Host and Origin a request must carry
 * (the proxy must preserve Host) and the paths it serves. The listener's own address is never a name a
 * client uses.
 *
 * Refusals answer with an empty body and, for a token problem, only the standard challenge: an error
 * code from RFC 6750 and where the metadata lives. Only failures are counted, so a peer holding a valid
 * token is never throttled, however many failures share its address. What a carrier reports about a
 * refused peer is a coarse address class, never the address.
 *
 * This module binds no listener; a carrier owns its socket and calls these per request.
 */

import { BlockList, isIP } from 'node:net';

import type { IncomingMessage, ServerResponse } from 'node:http';

const WELL_KNOWN_PREFIX = '/.well-known/oauth-protected-resource';
/** Window over which one address's failures are counted. */
const FAILURE_WINDOW_MS = 60_000;
/** Failures one address may have in a window before its further failures answer 429. */
const MAX_FAILURES_PER_WINDOW = 20;
/** Addresses tracked at once; the oldest is forgotten first, so a spray cannot grow memory. */
const MAX_TRACKED_ADDRESSES = 4096;
/** RFC 6749 scope-token characters: printable ASCII except space, `"` and `\`. */
const SCOPE_TOKEN = /^[\x21\x23-\x5b\x5d-\x7e]+$/;

/** A coarse class of a peer's address; the address itself is never reported. */
export type TRemoteAddressClass = 'loopback' | 'private' | 'public' | 'unknown';

/** Where a refused request came from, and whether its address is over the failure budget. */
export interface IBearerFailure {
  readonly remote: TRemoteAddressClass;
  readonly throttled: boolean;
  readonly retryAfterSeconds: number;
}

/** The public-facing identity of one resource server and its per-address failure budget. */
export interface IBearerResourceServer {
  /** The parsed public URL; its path is the resource's base path. */
  readonly url: URL;
  /**
   * Host and Origin must name the public URL. On a mismatch the 403 is written and false returned;
   * nothing is counted, since no credential was judged.
   */
  checkNames(req: IncomingMessage, res: ServerResponse): boolean;
  /** Count one failure against the request's peer. */
  fail(req: IncomingMessage): IBearerFailure;
  /** The request's peer class without counting anything. */
  remote(req: IncomingMessage): TRemoteAddressClass;
}

/** The challenges and metadata of one protected resource (one audience). */
export interface IProtectedResource {
  /** The RFC 9728 path clients fetch the metadata from. */
  readonly wellKnownPath: string;
  readonly metadata: string;
  readonly challenges: {
    readonly missing: string;
    readonly invalid: string;
    readonly scope: string;
  };
}

const LOOPBACK_RANGES = new BlockList();
LOOPBACK_RANGES.addSubnet('127.0.0.0', 8, 'ipv4');
LOOPBACK_RANGES.addAddress('::1', 'ipv6');
const PRIVATE_RANGES = new BlockList();
PRIVATE_RANGES.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVATE_RANGES.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVATE_RANGES.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVATE_RANGES.addSubnet('169.254.0.0', 16, 'ipv4');
PRIVATE_RANGES.addSubnet('100.64.0.0', 10, 'ipv4');
PRIVATE_RANGES.addSubnet('fc00::', 7, 'ipv6');
PRIVATE_RANGES.addSubnet('fe80::', 10, 'ipv6');

/** A literal address in one spelling: IPv4-mapped IPv6 folded to IPv4, IPv6 lowercased. */
function normalizeAddress(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const text = value.trim().toLowerCase();
  const mapped = text.startsWith('::ffff:') ? text.slice('::ffff:'.length) : undefined;
  if (mapped !== undefined && isIP(mapped) === 4) return mapped;
  return isIP(text) === 0 ? undefined : text;
}

function classifyAddress(address: string | undefined): TRemoteAddressClass {
  if (address === undefined) return 'unknown';
  const family = isIP(address) === 4 ? 'ipv4' : 'ipv6';
  if (LOOPBACK_RANGES.check(address, family)) return 'loopback';
  if (PRIVATE_RANGES.check(address, family)) return 'private';
  return 'public';
}

/** Parse a resource server's public URL: plain `https`, no credentials, query or fragment. */
export function parsePublicHttpsUrl(publicUrl: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(publicUrl);
  } catch {
    throw new Error(`${label} public URL must be an absolute https URL`);
  }
  if (url.protocol !== 'https:') throw new Error(`${label} public URL must use https`);
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new Error(`${label} public URL must not carry credentials, a query or a fragment`);
  }
  return url;
}

interface IFailureWindow {
  count: number;
  startedAt: number;
}

/** Counts failures per address in fixed windows. Only failures are ever recorded here. */
function createFailureCounter(now: () => number) {
  const windows = new Map<string, IFailureWindow>();
  return (address: string): { throttled: boolean; retryAfterSeconds: number } => {
    const at = now();
    let entry = windows.get(address);
    if (entry === undefined || at - entry.startedAt >= FAILURE_WINDOW_MS) {
      windows.delete(address);
      if (windows.size >= MAX_TRACKED_ADDRESSES) {
        for (const [key, value] of windows) {
          if (at - value.startedAt >= FAILURE_WINDOW_MS) windows.delete(key);
        }
        const oldest = windows.keys().next();
        if (windows.size >= MAX_TRACKED_ADDRESSES && oldest.done !== true) {
          windows.delete(oldest.value);
        }
      }
      entry = { count: 0, startedAt: at };
      windows.set(address, entry);
    }
    entry.count += 1;
    const remainingMs = FAILURE_WINDOW_MS - (at - entry.startedAt);
    return {
      throttled: entry.count > MAX_FAILURES_PER_WINDOW,
      retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
    };
  };
}

/**
 * Build the public identity of a resource server. Throws when the public URL is not plain `https`,
 * or a trusted proxy is not a literal address. `label` names the carrier in those messages.
 */
export function createBearerResourceServer(options: {
  readonly publicUrl: string;
  /** Proxy addresses whose `X-Forwarded-For` is believed. Absent: the header is ignored. */
  readonly trustedProxies?: readonly string[];
  readonly label: string;
  readonly now?: () => number;
}): IBearerResourceServer {
  const url = parsePublicHttpsUrl(options.publicUrl, options.label);
  const trustedProxies = new Set<string>();
  for (const proxy of options.trustedProxies ?? []) {
    const address = normalizeAddress(proxy);
    if (address === undefined) {
      throw new Error(`${options.label} trusted proxy must be a literal IP address`);
    }
    trustedProxies.add(address);
  }
  const expectedHosts = new Set([url.host]);
  if (url.port === '') expectedHosts.add(`${url.hostname}:443`);
  const failures = createFailureCounter(options.now ?? (() => performance.now()));

  function remoteAddress(req: IncomingMessage): string | undefined {
    const peer = normalizeAddress(req.socket.remoteAddress);
    if (peer === undefined || !trustedProxies.has(peer)) return peer;
    const header = req.headers['x-forwarded-for'];
    const hops = (Array.isArray(header) ? header.join(',') : (header ?? '')).split(',');
    // Walk from the proxy inward: the nearest hop not itself a trusted proxy is the client, as the
    // trusted proxy saw it. Hops further left were written by the client and are not believed.
    for (let index = hops.length - 1; index >= 0; index -= 1) {
      const hop = normalizeAddress(hops[index]);
      if (hop === undefined) return peer;
      if (!trustedProxies.has(hop)) return hop;
    }
    return peer;
  }

  return {
    url,
    checkNames(req, res) {
      const host = req.headers.host?.toLowerCase();
      const origin = req.headers.origin;
      if (
        host === undefined ||
        !expectedHosts.has(host) ||
        (origin !== undefined && origin !== url.origin)
      ) {
        res.writeHead(403).end();
        return false;
      }
      return true;
    },
    fail(req) {
      const address = remoteAddress(req);
      return { remote: classifyAddress(address), ...failures(address ?? 'unknown') };
    },
    remote(req) {
      return classifyAddress(remoteAddress(req));
    },
  };
}

/**
 * Describe one protected resource: where its RFC 9728 metadata lives and the challenges that point
 * there. Throws for a non-`https` issuer, or no scope or a scope a challenge cannot quote.
 */
export function describeProtectedResource(options: {
  /** The resource identifier (`aud`), an `https` URL. */
  readonly resource: string;
  readonly issuer: string;
  readonly scopes: readonly string[];
  readonly label: string;
}): IProtectedResource {
  const url = parsePublicHttpsUrl(options.resource, options.label);
  let issuer: URL;
  try {
    issuer = new URL(options.issuer);
  } catch {
    throw new Error(`${options.label} authorization issuer must be an absolute https URL`);
  }
  if (issuer.protocol !== 'https:') {
    throw new Error(`${options.label} authorization issuer must use https`);
  }
  if (options.scopes.length === 0 || !options.scopes.every((scope) => SCOPE_TOKEN.test(scope))) {
    throw new Error(`${options.label} authorization needs at least one valid scope`);
  }
  // RFC 9728 §3.1: the well-known segment goes between the host and the resource's path, with a
  // lone terminating slash dropped.
  const wellKnownPath = `${WELL_KNOWN_PREFIX}${url.pathname === '/' ? '' : url.pathname}`;
  const metadataUrl = `${url.origin}${wellKnownPath}`;
  const scopeList = options.scopes.join(' ');
  return {
    wellKnownPath,
    metadata: JSON.stringify({
      resource: options.resource,
      authorization_servers: [options.issuer],
      scopes_supported: [...options.scopes],
      bearer_methods_supported: ['header'],
    }),
    challenges: {
      missing: `Bearer resource_metadata="${metadataUrl}"`,
      invalid: `Bearer error="invalid_token", resource_metadata="${metadataUrl}"`,
      scope: `Bearer error="insufficient_scope", scope="${scopeList}", resource_metadata="${metadataUrl}"`,
    },
  };
}

/** Answer a metadata request: GET only, the JSON document, nothing else. */
export function serveProtectedResourceMetadata(
  req: IncomingMessage,
  res: ServerResponse,
  resource: IProtectedResource,
): void {
  if (req.method !== 'GET') {
    res.writeHead(405, { Allow: 'GET' }).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(resource.metadata);
}

/**
 * Answer a refused bearer token after its failure was counted: 429 once the peer is over budget,
 * 403 `insufficient_scope` for a missing scope, otherwise 401 with the missing-token or
 * `invalid_token` challenge. Always an empty body.
 */
export function refuseBearerToken(
  res: ServerResponse,
  resource: IProtectedResource,
  refusal: 'missing-token' | 'missing-scope' | 'invalid-token',
  failure: IBearerFailure,
): void {
  if (failure.throttled) {
    res.writeHead(429, { 'Retry-After': String(failure.retryAfterSeconds) }).end();
  } else if (refusal === 'missing-scope') {
    res.writeHead(403, { 'WWW-Authenticate': resource.challenges.scope }).end();
  } else {
    const challenge =
      refusal === 'missing-token' ? resource.challenges.missing : resource.challenges.invalid;
    res.writeHead(401, { 'WWW-Authenticate': challenge }).end();
  }
}

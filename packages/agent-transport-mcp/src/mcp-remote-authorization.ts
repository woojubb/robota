/**
 * The admission gate of the remote MCP HTTP host: an OAuth resource server in the sense of
 * RFC 6750 (bearer challenges) and RFC 9728 (protected-resource metadata).
 *
 * The host is reached through its PUBLIC URL, usually behind a reverse proxy, so every name the gate
 * checks comes from that URL rather than from the listener: the endpoint path and the metadata path
 * (a proxy prefix therefore works when the proxy forwards the path unchanged), and the Host and
 * Origin a request must carry (the proxy must preserve Host). The listener's own address is never a
 * name a client uses.
 *
 * Refusals answer with an empty body and, for a token problem, only the standard challenge: an error
 * code from RFC 6750 and where the metadata lives. Nothing describes WHY in prose, so a refusal
 * cannot leak which check failed beyond the code a client is entitled to.
 *
 * The token is verified before anything is counted, and only failures are counted, so a peer holding
 * a valid token is never throttled — however many failures share its address. Each failure is also
 * handed to an audit sink as a closed-set reason and a coarse address class, never token text.
 */

import { BlockList, isIP } from 'node:net';

import { bearerCredential } from '@robota-sdk/agent-transport/node';

import type {
  IAccessTokenVerifier,
  TAccessTokenRefusal,
} from '@robota-sdk/agent-interface-transport';
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

/** Why a remote request was refused: a verifier refusal, or no bearer token at all. */
export type TMcpRemoteRefusal = TAccessTokenRefusal | 'missing-token';

/** A coarse class of the refused peer's address; the address itself is never reported. */
export type TMcpRemoteAddressClass = 'loopback' | 'private' | 'public' | 'unknown';

/** One refused request, as the audit sink sees it. Carries no token text and no claim value. */
export interface IMcpRemoteAuditRecord {
  readonly refusal: TMcpRemoteRefusal;
  readonly remote: TMcpRemoteAddressClass;
  /** True when the refusal was answered 429 because the address exceeded its failure budget. */
  readonly throttled: boolean;
}

/** How the remote host decides who may reach the session. */
export interface IMcpRemoteAuthorization {
  /** The `https` URL clients use for the MCP endpoint; also the resource identifier (`aud`). */
  readonly publicUrl: string;
  /** The authorization server named in the protected-resource metadata. */
  readonly issuer: string;
  /** Scopes a token must carry; advertised as `scopes_supported` and in `insufficient_scope`. */
  readonly scopes: readonly string[];
  /** Decides each presented token. Built for the same issuer, resource and scopes. */
  readonly verifier: IAccessTokenVerifier;
  /** Proxy addresses whose `X-Forwarded-For` is believed. Absent: the header is ignored. */
  readonly trustedProxies?: readonly string[];
  /** Receives one content-free record per refused request. */
  readonly audit?: (record: IMcpRemoteAuditRecord) => void;
}

export interface IMcpRemoteGate {
  readonly endpointPath: string;
  /** Resolves true when the request may reach MCP; otherwise the response has been written. */
  admit(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
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

function classifyAddress(address: string | undefined): TMcpRemoteAddressClass {
  if (address === undefined) return 'unknown';
  const family = isIP(address) === 4 ? 'ipv4' : 'ipv6';
  if (LOOPBACK_RANGES.check(address, family)) return 'loopback';
  if (PRIVATE_RANGES.check(address, family)) return 'private';
  return 'public';
}

function parsePublicUrl(publicUrl: string): URL {
  let url: URL;
  try {
    url = new URL(publicUrl);
  } catch {
    throw new Error('MCP HTTP public URL must be an absolute https URL');
  }
  if (url.protocol !== 'https:') throw new Error('MCP HTTP public URL must use https');
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new Error('MCP HTTP public URL must not carry credentials, a query or a fragment');
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
  return {
    /** Records one failure; answers whether the address is now over budget, and for how long. */
    fail(address: string): { throttled: boolean; retryAfterSeconds: number } {
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
    },
  };
}

/**
 * Builds the gate. Throws when the configuration cannot describe a safe resource server: a public
 * URL that is not plain `https`, a non-`https` issuer, no scope or a scope a challenge cannot quote,
 * or a trusted proxy that is not a literal address.
 */
export function createMcpRemoteGate(
  authorization: IMcpRemoteAuthorization,
  now: () => number = () => performance.now(),
): IMcpRemoteGate {
  const url = parsePublicUrl(authorization.publicUrl);
  let issuer: URL;
  try {
    issuer = new URL(authorization.issuer);
  } catch {
    throw new Error('MCP HTTP authorization issuer must be an absolute https URL');
  }
  if (issuer.protocol !== 'https:') throw new Error('MCP HTTP authorization issuer must use https');
  if (
    authorization.scopes.length === 0 ||
    !authorization.scopes.every((scope) => SCOPE_TOKEN.test(scope))
  ) {
    throw new Error('MCP HTTP authorization needs at least one valid scope');
  }
  const trustedProxies = new Set<string>();
  for (const proxy of authorization.trustedProxies ?? []) {
    const address = normalizeAddress(proxy);
    if (address === undefined)
      throw new Error('MCP HTTP trusted proxy must be a literal IP address');
    trustedProxies.add(address);
  }

  const endpointPath = url.pathname;
  // RFC 9728 §3.1: the well-known segment goes between the host and the resource's path, with a
  // lone terminating slash dropped.
  const wellKnownPath = `${WELL_KNOWN_PREFIX}${endpointPath === '/' ? '' : endpointPath}`;
  const resourceMetadataUrl = `${url.origin}${wellKnownPath}`;
  const expectedHosts = new Set([url.host]);
  if (url.port === '') expectedHosts.add(`${url.hostname}:443`);
  const metadata = JSON.stringify({
    resource: authorization.publicUrl,
    authorization_servers: [authorization.issuer],
    scopes_supported: [...authorization.scopes],
    bearer_methods_supported: ['header'],
  });
  const scopeList = authorization.scopes.join(' ');
  const challenges = {
    missing: `Bearer resource_metadata="${resourceMetadataUrl}"`,
    invalid: `Bearer error="invalid_token", resource_metadata="${resourceMetadataUrl}"`,
    scope: `Bearer error="insufficient_scope", scope="${scopeList}", resource_metadata="${resourceMetadataUrl}"`,
  };
  const failures = createFailureCounter(now);

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

  function refuse(req: IncomingMessage, res: ServerResponse, refusal: TMcpRemoteRefusal): void {
    const address = remoteAddress(req);
    const remote = classifyAddress(address);
    if (refusal === 'keys-unavailable') {
      // The issuer, not the peer, failed: not counted against the peer, and not a token verdict.
      authorization.audit?.({ refusal, remote, throttled: false });
      res.writeHead(503).end();
      return;
    }
    const budget = failures.fail(address ?? 'unknown');
    authorization.audit?.({ refusal, remote, throttled: budget.throttled });
    if (budget.throttled) {
      res.writeHead(429, { 'Retry-After': String(budget.retryAfterSeconds) }).end();
    } else if (refusal === 'missing-scope') {
      res.writeHead(403, { 'WWW-Authenticate': challenges.scope }).end();
    } else {
      const challenge = refusal === 'missing-token' ? challenges.missing : challenges.invalid;
      res.writeHead(401, { 'WWW-Authenticate': challenge }).end();
    }
  }

  return {
    endpointPath,
    async admit(req, res) {
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
      if (req.url === wellKnownPath) {
        if (req.method !== 'GET') {
          res.writeHead(405, { Allow: 'GET' }).end();
          return false;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(metadata);
        return false;
      }
      if (req.url !== endpointPath) {
        res.writeHead(404).end();
        return false;
      }
      const token = bearerCredential(req.headers.authorization);
      if (token === undefined) {
        refuse(req, res, 'missing-token');
        return false;
      }
      const verdict = await authorization.verifier.verify(token);
      if (verdict.admitted) return true;
      refuse(req, res, verdict.refusal);
      return false;
    },
  };
}

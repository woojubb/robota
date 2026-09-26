/**
 * The admission gate of the remote MCP HTTP host: an OAuth resource server in the sense of
 * RFC 6750 (bearer challenges) and RFC 9728 (protected-resource metadata).
 *
 * The name checks, challenges, metadata and failure throttle are the shared resource-server gate of
 * `@robota-sdk/agent-transport/node`; this host adds only its one endpoint and its verifier. The MCP
 * endpoint is the public URL's own path, so the public URL is also the resource identifier (`aud`).
 *
 * The token is verified before anything is counted, and only failures are counted. Each failure is
 * handed to an audit sink as a closed-set reason and a coarse address class, never token text.
 */

import {
  bearerCredential,
  createBearerResourceServer,
  describeProtectedResource,
  refuseBearerToken,
  serveProtectedResourceMetadata,
} from '@robota-sdk/agent-transport/node';

import type {
  IAccessTokenVerifier,
  TAccessTokenRefusal,
} from '@robota-sdk/agent-interface-transport';
import type { TRemoteAddressClass } from '@robota-sdk/agent-transport/node';
import type { IncomingMessage, ServerResponse } from 'node:http';

const LABEL = 'MCP HTTP';

/** Why a remote request was refused: a verifier refusal, or no bearer token at all. */
export type TMcpRemoteRefusal = TAccessTokenRefusal | 'missing-token';

/** A coarse class of the refused peer's address; the address itself is never reported. */
export type TMcpRemoteAddressClass = TRemoteAddressClass;

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

/**
 * Builds the gate. Throws when the configuration cannot describe a safe resource server: a public
 * URL that is not plain `https`, a non-`https` issuer, no scope or a scope a challenge cannot quote,
 * or a trusted proxy that is not a literal address.
 */
export function createMcpRemoteGate(
  authorization: IMcpRemoteAuthorization,
  now: () => number = () => performance.now(),
): IMcpRemoteGate {
  const resource = describeProtectedResource({
    resource: authorization.publicUrl,
    issuer: authorization.issuer,
    scopes: authorization.scopes,
    label: LABEL,
  });
  const server = createBearerResourceServer({
    publicUrl: authorization.publicUrl,
    ...(authorization.trustedProxies !== undefined
      ? { trustedProxies: authorization.trustedProxies }
      : {}),
    label: LABEL,
    now,
  });
  const endpointPath = server.url.pathname;

  function refuse(req: IncomingMessage, res: ServerResponse, refusal: TMcpRemoteRefusal): void {
    if (refusal === 'keys-unavailable') {
      // The issuer, not the peer, failed: not counted against the peer, and not a token verdict.
      authorization.audit?.({ refusal, remote: server.remote(req), throttled: false });
      res.writeHead(503).end();
      return;
    }
    const failure = server.fail(req);
    authorization.audit?.({ refusal, remote: failure.remote, throttled: failure.throttled });
    refuseBearerToken(
      res,
      resource,
      refusal === 'missing-token' || refusal === 'missing-scope' ? refusal : 'invalid-token',
      failure,
    );
  }

  return {
    endpointPath,
    async admit(req, res) {
      if (!server.checkNames(req, res)) return false;
      if (req.url === resource.wellKnownPath) {
        serveProtectedResourceMetadata(req, res, resource);
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

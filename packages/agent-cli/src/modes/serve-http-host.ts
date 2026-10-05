/**
 * The agent HTTP API of `--serve`: the routes of `@robota-sdk/agent-transport-http` on a listener,
 * so another application or service can submit work, stream the result over SSE, run a command and
 * abort without a Robota client library.
 *
 * Serve mode owns it the way it owns the external-event endpoint: started once the runtime host is
 * up, stopped before the host shuts down. Each request resolves the runtime's current primary
 * session, so a session the runtime replaces is followed without binding again. The
 * one-turn-per-session rule is the routes' own.
 *
 * Admission takes one of two forms. On loopback the routes admit by the operator's bearer. As an
 * OAuth resource server — the only way this API binds any other address — the shared resource-server
 * gate of `@robota-sdk/agent-transport/node` stands in front: public-URL name checks, RFC 9728
 * metadata, access tokens decided by the issuer's keys, and a failure-only throttle. The routes
 * behind it are then built open, with that gate written down as the reason, so the two admissions
 * never both judge one request.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { getRequestListener } from '@hono/node-server';
import {
  bearerCredential,
  createAccessTokenVerifier,
  createBearerResourceServer,
  describeProtectedResource,
  refuseBearerToken,
  serveProtectedResourceMetadata,
} from '@robota-sdk/agent-transport/node';
import { createAgentRoutes } from '@robota-sdk/agent-transport-http';

import { ACCESS_TOKEN_ALGORITHMS } from './mcp-serve-mode.js';

import type { IMcpServeRemoteOptions } from './mcp-serve-mode.js';
import type {
  ITransportAdmissionConfig,
  TAccessTokenRefusal,
} from '@robota-sdk/agent-interface-transport';
import type { TRemoteAddressClass } from '@robota-sdk/agent-transport/node';
import type { IHttpTransportSession } from '@robota-sdk/agent-transport-http';

const LOOPBACK = '127.0.0.1';
const LABEL = 'HTTP API';
/**
 * Who an HTTP turn is attributed to: assigned here, never taken from the request, so a client cannot
 * record its turns as the local operator's or another surface's. The same in both admission modes:
 * the verifier's verdict carries no claims, and the subject allowlist already names who may reach
 * the session, so no token value is written into the session's history.
 */
const HTTP_TURN_ATTRIBUTION = { driverId: 'remote:http', surface: 'remote' } as const;

/** One refused request as the operator sees it: a closed-set reason and a coarse address class. */
export interface IServeHttpRefusal {
  readonly refusal: TAccessTokenRefusal | 'missing-token';
  readonly remote: TRemoteAddressClass;
  readonly throttled: boolean;
}

export interface IServeHttpHostOptions {
  /** Port to bind. */
  readonly port: number;
  /** The bearer every request presents on loopback. Exactly one of `token` and `remote`. */
  readonly token?: string;
  /** The OAuth resource-server settings; the only mode that may bind a non-loopback address. */
  readonly remote?: IMcpServeRemoteOptions;
  /** The session a request reaches, resolved per request. */
  readonly session: () => IHttpTransportSession;
  /** Where the detail of a stream that failed after its headers goes; the client gets a generic line. */
  readonly onStreamFailure?: (error: Error) => void;
  /** Receives one content-free record per request the resource-server gate refused. */
  readonly onRefusal?: (record: IServeHttpRefusal) => void;
}

export interface IServeHttpHost {
  /** The URL clients use: `http://127.0.0.1:<port>`, or the public URL. Never carries a bearer. */
  readonly url: string;
  /** The bound `address:port`. */
  readonly listening: string;
  stop(): Promise<void>;
}

const GATE_IN_FRONT: ITransportAdmissionConfig = {
  open: true,
  openReason: 'admitted by the OAuth resource-server gate in front of these routes',
};

export async function startServeHttpHost(options: IServeHttpHostOptions): Promise<IServeHttpHost> {
  if ((options.token === undefined) === (options.remote === undefined)) {
    throw new Error('HTTP API needs exactly one of a loopback bearer and remote authorization');
  }
  const remote = options.remote;
  const routes = createAgentRoutes({
    sessionFactory: options.session,
    admission: remote === undefined ? { token: options.token ?? '' } : GATE_IN_FRONT,
    attribution: HTTP_TURN_ATTRIBUTION,
    ...(options.onStreamFailure !== undefined ? { onStreamFailure: options.onStreamFailure } : {}),
  });
  const listener = getRequestListener(routes.fetch);
  const handler = remote === undefined ? listener : remoteHandler(remote, listener, options);
  const host = remote?.host ?? LOOPBACK;
  const server = createServer(handler);
  await listen(server, options.port, host);
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await close(server);
    throw new Error('HTTP API listener has no port.');
  }
  const bound = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  return {
    url: remote?.publicUrl ?? `http://${LOOPBACK}:${address.port}`,
    listening: `${bound}:${address.port}`,
    // An open SSE stream would hold `close()` until it ends, so live connections are cut first.
    stop: async () => {
      server.closeAllConnections();
      await close(server);
    },
  };
}

/**
 * The resource-server gate in front of the routes. The public URL is the resource identifier
 * (`aud`) and its path is the API's base path: a request reaches the routes only under it, with the
 * base removed. The token is verified before anything is counted, and only failures are counted.
 */
function remoteHandler(
  remote: IMcpServeRemoteOptions,
  listener: (req: IncomingMessage, res: ServerResponse) => unknown,
  options: IServeHttpHostOptions,
): (req: IncomingMessage, res: ServerResponse) => void {
  const resource = describeProtectedResource({
    resource: remote.publicUrl,
    issuer: remote.issuer,
    scopes: remote.scopes,
    label: LABEL,
  });
  const server = createBearerResourceServer({
    publicUrl: remote.publicUrl,
    trustedProxies: remote.trustedProxies,
    label: LABEL,
  });
  const verifier = createAccessTokenVerifier({
    issuer: remote.issuer,
    resource: remote.publicUrl,
    algorithms: ACCESS_TOKEN_ALGORITHMS,
    requiredScopes: remote.scopes,
    allowedSubjects: remote.allowedSubjects,
  });
  const base = server.url.pathname.replace(/\/$/, '');

  function refuse(
    req: IncomingMessage,
    res: ServerResponse,
    refusal: TAccessTokenRefusal | 'missing-token',
  ): void {
    if (refusal === 'keys-unavailable') {
      // The issuer, not the peer, failed: not counted against the peer, and not a token verdict.
      options.onRefusal?.({ refusal, remote: server.remote(req), throttled: false });
      res.writeHead(503).end();
      return;
    }
    const failure = server.fail(req);
    options.onRefusal?.({ refusal, remote: failure.remote, throttled: failure.throttled });
    refuseBearerToken(
      res,
      resource,
      refusal === 'missing-token' || refusal === 'missing-scope' ? refusal : 'invalid-token',
      failure,
    );
  }

  async function admit(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!server.checkNames(req, res)) return;
    const target = req.url ?? '';
    if (target === resource.wellKnownPath) {
      serveProtectedResourceMetadata(req, res, resource);
      return;
    }
    const path = target.split('?')[0] ?? '';
    if (!path.startsWith(`${base}/`)) {
      res.writeHead(404).end();
      return;
    }
    const token = bearerCredential(req.headers.authorization);
    if (token === undefined) {
      refuse(req, res, 'missing-token');
      return;
    }
    const verdict = await verifier.verify(token);
    if (!verdict.admitted) {
      refuse(req, res, verdict.refusal);
      return;
    }
    req.url = target.slice(base.length);
    await listener(req, res);
  }

  return (req, res) => {
    admit(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  };
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

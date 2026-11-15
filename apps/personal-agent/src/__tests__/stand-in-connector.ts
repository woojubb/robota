/**
 * Stand-ins for an external service and its authorization server, written for the tests: real HTTP
 * servers on loopback that speak just enough of the standards for a connector to sign in, list its
 * tools, call them and be revoked. They stand in for any service, which is the point: a mail, a
 * calendar and a notes connector differ only in the tools the stand-in is given.
 *
 * They serve plain HTTP, or TLS when given a key and certificate; the protocol requires `https`
 * addresses, so an in-process test maps a logical `https` host to the loopback port with
 * `virtualHostFetch`, and a run of the real CLI uses TLS and trusts the certificate.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';

import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface IStandInTls {
  readonly key: string;
  readonly cert: string;
}

interface IRunning {
  readonly port: number;
  readonly server: Server;
  close(): Promise<void>;
}

async function listen(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  tls: IStandInTls | undefined,
  port = 0,
): Promise<IRunning> {
  const server =
    tls === undefined
      ? createHttpServer(handler)
      : (createHttpsServer({ key: tls.key, cert: tls.cert }, handler) as unknown as Server);
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()));
  return {
    port: (server.address() as AddressInfo).port,
    server,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (data += chunk));
    req.on('end', () => resolve(data));
  });
}

function json(res: ServerResponse, status: number, body: unknown, headers = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

const sha256url = (text: string): string => createHash('sha256').update(text).digest('base64url');

// ---------------------------------------------------------------------------------------------
// The authorization server
// ---------------------------------------------------------------------------------------------

export interface IStandInAuthorizationServer {
  readonly port: number;
  /** The address the protocol sees, such as `https://auth.stand-in.test`. */
  readonly issuer: string;
  /** Access tokens currently valid. */
  validTokens(): readonly string[];
  /** How many refresh-token grants were served. */
  readonly refreshes: () => number;
  /** Tokens the client asked to revoke, in order. */
  readonly revoked: readonly string[];
  /** The dynamically registered clients' redirect URIs. */
  readonly registrations: readonly { readonly clientId: string; readonly redirectUris: string[] }[];
  /** The query of every authorization request, as the browser was sent it. */
  readonly authorizationRequests: readonly Readonly<Record<string, string>>[];
  /** How many token requests were refused for want of the client secret. */
  readonly secretRefusals: () => number;
  /** Make the next revocation request fail with this status. */
  failRevocation(status: number): void;
  /** Drop the revocation endpoint from the metadata, as a server that offers none. */
  withoutRevocation(): void;
  close(): Promise<void>;
}

export interface IStandInAuthorizationOptions {
  /** Where the protocol sees this server; defaults to its own loopback address. */
  readonly publicBase?: string;
  readonly tls?: IStandInTls;
  readonly port?: number;
  /** Lifetime of an access token, so a test can make it expire. */
  readonly accessTokenSeconds?: number;
  /**
   * A service that gives a pre-registered client a secret and no dynamic registration: the token
   * endpoint needs this secret (as the client's HTTP Basic credential or a form field) on every grant.
   */
  readonly requiredClientSecret?: string;
  /** A service that issues a refresh token only when the authorization request asked for offline access. */
  readonly refreshOnlyWhenOfflineRequested?: boolean;
}

interface ICode {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly challenge: string;
  readonly scope: string;
  readonly resource: string;
  readonly offline: boolean;
}

export async function startStandInAuthorizationServer(
  options: IStandInAuthorizationOptions = {},
): Promise<IStandInAuthorizationServer> {
  const tls = options.tls;
  let base = options.publicBase ?? '';
  const clients = new Map<string, string[]>();
  const transactions = new Map<string, ICode & { state: string }>();
  const codes = new Map<string, ICode>();
  const accessTokens = new Map<string, { expiresAt: number; scope: string; resource: string }>();
  const refreshTokens = new Map<string, ICode>();
  const revoked: string[] = [];
  const authorizationRequests: Record<string, string>[] = [];
  let secretRefusals = 0;
  let refreshes = 0;
  let revocationFailure: number | undefined;
  let revocationOffered = true;
  const lifetime = (options.accessTokenSeconds ?? 3600) * 1000;

  const issue = (code: ICode): Record<string, unknown> => {
    const access = `at-${randomBytes(12).toString('hex')}`;
    const refresh = `rt-${randomBytes(12).toString('hex')}`;
    accessTokens.set(access, {
      expiresAt: Date.now() + lifetime,
      scope: code.scope,
      resource: code.resource,
    });
    const refreshable = options.refreshOnlyWhenOfflineRequested !== true || code.offline;
    if (refreshable) refreshTokens.set(refresh, code);
    return {
      access_token: access,
      token_type: 'Bearer',
      expires_in: Math.floor(lifetime / 1000),
      ...(refreshable && { refresh_token: refresh }),
      scope: code.scope,
    };
  };

  /** The secret a client presented, by HTTP Basic or by form field. */
  const presentedSecret = (req: IncomingMessage, form: URLSearchParams): string | undefined => {
    const header = req.headers.authorization;
    if (header?.startsWith('Basic ') === true) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      return separator < 0 ? undefined : decodeURIComponent(decoded.slice(separator + 1));
    }
    return form.get('client_secret') ?? undefined;
  };

  const running = await listen(
    (req, res) => {
      void (async () => {
        const url = new URL(req.url ?? '/', 'http://stand-in');
        if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
          return json(res, 200, {
            issuer: base,
            authorization_endpoint: `${base}/authorize`,
            token_endpoint: `${base}/token`,
            ...(options.requiredClientSecret === undefined && {
              registration_endpoint: `${base}/register`,
            }),
            ...(revocationOffered && { revocation_endpoint: `${base}/revoke` }),
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            code_challenge_methods_supported: ['S256'],
            token_endpoint_auth_methods_supported:
              options.requiredClientSecret === undefined
                ? ['none']
                : ['client_secret_basic', 'client_secret_post'],
            authorization_response_iss_parameter_supported: true,
          });
        }
        if (req.method === 'POST' && url.pathname === '/register') {
          const body = JSON.parse(await readBody(req)) as { redirect_uris: string[] };
          const clientId = `client-${randomBytes(6).toString('hex')}`;
          clients.set(clientId, body.redirect_uris);
          return json(res, 201, {
            client_id: clientId,
            redirect_uris: body.redirect_uris,
            token_endpoint_auth_method: 'none',
          });
        }
        if (req.method === 'GET' && url.pathname === '/authorize') {
          const clientId = url.searchParams.get('client_id') ?? '';
          const redirectUri = url.searchParams.get('redirect_uri') ?? '';
          const known = clients.get(clientId);
          // A pre-registered client has no registration here: its redirect is taken as given.
          if (known !== undefined && !known.includes(redirectUri)) {
            return json(res, 400, { error: 'invalid_redirect_uri' });
          }
          if (url.searchParams.get('code_challenge_method') !== 'S256') {
            return json(res, 400, { error: 'pkce_required' });
          }
          authorizationRequests.push(Object.fromEntries(url.searchParams));
          const txn = randomBytes(8).toString('hex');
          transactions.set(txn, {
            clientId,
            redirectUri,
            challenge: url.searchParams.get('code_challenge') ?? '',
            scope: url.searchParams.get('scope') ?? '',
            resource: url.searchParams.get('resource') ?? '',
            offline: url.searchParams.get('access_type') === 'offline',
            state: url.searchParams.get('state') ?? '',
          });
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          return void res.end(
            `<!doctype html><title>Stand-in consent</title><h1>Allow access?</h1>` +
              `<p>${known === undefined ? 'A client' : 'A registered client'} asks to use your account.</p>` +
              `<a id="approve" href="/approve?txn=${txn}">Approve</a> ` +
              `<a id="deny" href="/deny?txn=${txn}">Deny</a>`,
          );
        }
        if (req.method === 'GET' && (url.pathname === '/approve' || url.pathname === '/deny')) {
          const txn = transactions.get(url.searchParams.get('txn') ?? '');
          if (txn === undefined) return json(res, 400, { error: 'unknown_transaction' });
          transactions.delete(url.searchParams.get('txn') ?? '');
          const back = new URL(txn.redirectUri);
          back.searchParams.set('state', txn.state);
          back.searchParams.set('iss', base);
          if (url.pathname === '/deny') back.searchParams.set('error', 'access_denied');
          else {
            const code = randomBytes(12).toString('hex');
            codes.set(code, txn);
            back.searchParams.set('code', code);
          }
          res.writeHead(302, { location: back.href });
          return void res.end();
        }
        if (req.method === 'POST' && url.pathname === '/token') {
          const form = new URLSearchParams(await readBody(req));
          if (
            options.requiredClientSecret !== undefined &&
            presentedSecret(req, form) !== options.requiredClientSecret
          ) {
            secretRefusals += 1;
            return json(res, 401, { error: 'invalid_client' });
          }
          if (form.get('grant_type') === 'authorization_code') {
            const code = codes.get(form.get('code') ?? '');
            codes.delete(form.get('code') ?? '');
            if (
              code === undefined ||
              code.redirectUri !== form.get('redirect_uri') ||
              sha256url(form.get('code_verifier') ?? '') !== code.challenge
            ) {
              return json(res, 400, { error: 'invalid_grant' });
            }
            return json(res, 200, issue(code));
          }
          if (form.get('grant_type') === 'refresh_token') {
            const grant = refreshTokens.get(form.get('refresh_token') ?? '');
            if (grant === undefined) return json(res, 400, { error: 'invalid_grant' });
            // Rotation: the spent refresh token is never valid again.
            refreshTokens.delete(form.get('refresh_token') ?? '');
            refreshes += 1;
            return json(res, 200, issue(grant));
          }
          return json(res, 400, { error: 'unsupported_grant_type' });
        }
        if (req.method === 'POST' && url.pathname === '/revoke') {
          if (revocationFailure !== undefined) {
            const status = revocationFailure;
            revocationFailure = undefined;
            return json(res, status, { error: 'temporarily_unavailable' });
          }
          const token = new URLSearchParams(await readBody(req)).get('token') ?? '';
          revoked.push(token);
          accessTokens.delete(token);
          refreshTokens.delete(token);
          return json(res, 200, {});
        }
        json(res, 404, { error: 'not_found' });
      })().catch(() => json(res, 500, { error: 'stand-in failure' }));
    },
    tls,
    options.port,
  );
  base =
    options.publicBase ?? `${tls === undefined ? 'http' : 'https'}://127.0.0.1:${running.port}`;

  return {
    port: running.port,
    issuer: base,
    validTokens: () =>
      [...accessTokens].filter(([, token]) => token.expiresAt > Date.now()).map(([id]) => id),
    refreshes: () => refreshes,
    revoked,
    get registrations() {
      return [...clients].map(([clientId, redirectUris]) => ({ clientId, redirectUris }));
    },
    get authorizationRequests() {
      return authorizationRequests.map((query) => ({ ...query }));
    },
    secretRefusals: () => secretRefusals,
    failRevocation: (status) => {
      revocationFailure = status;
    },
    withoutRevocation: () => {
      revocationOffered = false;
    },
    close: running.close,
  };
}

// ---------------------------------------------------------------------------------------------
// The connector (a tool server that needs a bearer token)
// ---------------------------------------------------------------------------------------------

export interface IStandInTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
  /** What the server claims about the tool; omit for a tool that claims nothing. */
  readonly annotations?: Record<string, unknown>;
  /** What the tool returns, as text. */
  readonly run: (args: Record<string, unknown>) => string;
}

export interface IStandInConnector {
  readonly port: number;
  /** The address the protocol sees. */
  readonly url: string;
  /** Every tool call the server received, as `name args`, in order. */
  readonly calls: string[];
  /** How many requests were refused for a missing or wrong credential. */
  readonly refusals: () => number;
  /** The `authorization` header of every request to the tool endpoint, in order; `undefined` when it carried none. */
  readonly authorizations: (string | undefined)[];
  /** Change the static token it wants, as a service that rotates its tokens does. */
  rotateToken(token: string): void;
  /** Answer every request to the tool endpoint this many milliseconds late, as a slow service does. */
  setLatency(milliseconds: number): void;
  close(): Promise<void>;
}

export interface IStandInConnectorOptions {
  /** The authorization server whose tokens it honours; omit for a server with `access`. */
  readonly authorization?: IStandInAuthorizationServer & { acceptsToken(token: string): boolean };
  /**
   * Without an authorization server: a static token it wants (as a bearer token, or raw in `header`),
   * or `open` for a server that asks for nothing.
   */
  readonly access?: { readonly token: string; readonly header?: string } | 'open';
  readonly tools: readonly IStandInTool[];
  /** Where the protocol sees this server; defaults to its own loopback address plus `/mcp`. */
  readonly publicBase?: string;
  readonly tls?: IStandInTls;
  readonly port?: number;
}

/** The authorization server's view a connector needs: whether a bearer token is one it issued and still honours. */
export function withTokenCheck(
  server: IStandInAuthorizationServer,
): IStandInAuthorizationServer & { acceptsToken(token: string): boolean } {
  return Object.assign(server, {
    acceptsToken: (token: string) => server.validTokens().includes(token),
  });
}

export async function startStandInConnector(
  options: IStandInConnectorOptions,
): Promise<IStandInConnector> {
  const calls: string[] = [];
  const authorizations: (string | undefined)[] = [];
  let refusals = 0;
  let latencyMs = 0;
  let base = options.publicBase ?? '';
  const tools = new Map(options.tools.map((tool) => [tool.name, tool]));

  let staticToken =
    options.access === undefined || options.access === 'open' ? '' : options.access.token;

  /** Whether the request carries what this server asks for. */
  const admitted = (headers: IncomingMessage['headers']): boolean => {
    const access = options.access;
    if (access === 'open') return true;
    if (access !== undefined) {
      const header = (access.header ?? 'authorization').toLowerCase();
      const expected = header === 'authorization' ? `Bearer ${staticToken}` : staticToken;
      return headers[header] === expected;
    }
    const bearer = /^Bearer (.+)$/u.exec(headers.authorization ?? '')?.[1];
    return bearer !== undefined && options.authorization?.acceptsToken(bearer) === true;
  };

  const rpc = (res: ServerResponse, id: unknown, result: unknown): void =>
    json(res, 200, { jsonrpc: '2.0', id, result });

  const running = await listen(
    (req, res) => {
      void (async () => {
        const url = new URL(req.url ?? '/', 'http://stand-in');
        if (
          options.authorization !== undefined &&
          req.method === 'GET' &&
          url.pathname === '/.well-known/oauth-protected-resource/mcp'
        ) {
          return json(res, 200, {
            resource: `${base}/mcp`,
            authorization_servers: [options.authorization.issuer],
          });
        }
        if (url.pathname !== '/mcp') return json(res, 404, { error: 'not_found' });
        authorizations.push(req.headers.authorization);
        if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
        if (!admitted(req.headers)) {
          refusals += 1;
          return json(
            res,
            401,
            { error: 'invalid_token' },
            options.authorization === undefined
              ? {}
              : {
                  'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
                },
          );
        }
        if (req.method !== 'POST') return void res.writeHead(405).end();
        const message = JSON.parse(await readBody(req)) as {
          id?: unknown;
          method: string;
          params?: Record<string, unknown>;
        };
        if (message.id === undefined) return void res.writeHead(202).end();
        if (message.method === 'initialize') {
          return rpc(res, message.id, {
            protocolVersion: message.params?.['protocolVersion'],
            capabilities: { tools: {} },
            serverInfo: { name: 'stand-in', version: '1.0.0' },
          });
        }
        if (message.method === 'tools/list') {
          return rpc(res, message.id, {
            tools: [...tools.values()].map((tool) => ({
              name: tool.name,
              ...(tool.description !== undefined && { description: tool.description }),
              inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
              ...(tool.annotations !== undefined && { annotations: tool.annotations }),
            })),
          });
        }
        if (message.method === 'tools/call') {
          const name = String(message.params?.['name']);
          const args = (message.params?.['arguments'] ?? {}) as Record<string, unknown>;
          calls.push(`${name} ${JSON.stringify(args)}`);
          const tool = tools.get(name);
          if (tool === undefined) {
            return json(res, 200, {
              jsonrpc: '2.0',
              id: message.id,
              error: { code: -32602, message: 'unknown tool' },
            });
          }
          return rpc(res, message.id, {
            content: [{ type: 'text', text: tool.run(args) }],
            isError: false,
          });
        }
        json(res, 200, {
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: 'method not found' },
        });
      })().catch(() => json(res, 500, { error: 'stand-in failure' }));
    },
    options.tls,
    options.port,
  );
  base =
    options.publicBase ??
    `${options.tls === undefined ? 'http' : 'https'}://127.0.0.1:${running.port}`;
  return {
    port: running.port,
    url: `${base}/mcp`,
    calls,
    refusals: () => refusals,
    authorizations,
    rotateToken: (token) => {
      staticToken = token;
    },
    setLatency: (milliseconds) => {
      latencyMs = milliseconds;
    },
    close: running.close,
  };
}

// ---------------------------------------------------------------------------------------------
// Reaching the stand-ins through addresses the protocol accepts
// ---------------------------------------------------------------------------------------------

/**
 * A `fetch` that sends requests for logical `https` hosts to loopback ports and leaves every other
 * address alone. The protocol insists on `https`; this lets a test keep its servers on plain HTTP
 * while the code under test only ever sees `https` addresses.
 */
export function virtualHostFetch(hosts: Readonly<Record<string, number>>): typeof globalThis.fetch {
  return (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const port = hosts[url.host];
    if (port === undefined) return globalThis.fetch(request);
    const target = new URL(url.href);
    target.protocol = 'http:';
    target.host = `127.0.0.1:${port}`;
    return globalThis.fetch(new Request(target, request));
  };
}

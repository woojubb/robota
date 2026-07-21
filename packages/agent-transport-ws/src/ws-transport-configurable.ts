/**
 * Self-contained WS transport implementing IConfigurableTransport.
 * Owns the WebSocket server lifecycle (ws package), started/stopped via the transport registry.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';

import { createWsHandler } from '@robota-sdk/agent-transport-protocol';
import { WebSocketServer, WebSocket } from 'ws';

import type { TUniversalValue } from '@robota-sdk/agent-core';
import type {
  IConfigurableTransport,
  IInteractiveSession,
} from '@robota-sdk/agent-interface-transport';
import type { TServerMessage } from '@robota-sdk/agent-transport-protocol';

const DEFAULT_PORT = 7070;
const DEFAULT_MAX_RETRIES = 20;

export interface IWsTransportConfig {
  port?: number;
  maxRetries?: number;
  /**
   * OPTIONAL explicit loopback auth token. When set, every connection MUST present a matching token
   * (query param `?token=` or the `Sec-WebSocket-Protocol` subprotocol) or the socket is closed BEFORE any
   * session data is emitted (GUI-002; the GUI sidecar sets `ROBOTA_WS_TOKEN`). SEC-001: when this is unset
   * AND `open` is not `true`, the transport AUTO-MINTS a random per-launch token (secure by default) —
   * `resolvedToken` exposes it so the surface can deliver it to the co-located client (a `0600` connection
   * file / the served monitor's injected `ws-url`). An explicit token here always wins over the auto-mint.
   */
  token?: string;
  /**
   * SEC-001 discouraged opt-out: when `true`, run WITHOUT auth (no token, no auto-mint) — the pre-SEC-001
   * open loopback behavior. NOT RECOMMENDED (any local process or browser page can then drive+authorize the
   * session); mirrors Jupyter's `c.ServerApp.token = ''`. An explicit `token` takes precedence over `open`.
   */
  open?: boolean;
  /**
   * SEC-001 defense-in-depth: extra host names (beyond `localhost`/`127.0.0.1`/`::1`) accepted in the
   * upgrade `Host` header. The `Host` allow-list closes DNS-rebinding independently of the token.
   */
  allowedHosts?: readonly string[];
  /**
   * SEC-001 defense-in-depth: extra browser `Origin`s (beyond loopback) accepted on the upgrade — e.g. the
   * `apps/agent-web` app origin. A browser sends an unforgeable `Origin`; a non-browser client omits it (and
   * is gated by the token instead). Closes the "any web page in any browser" hole before history is emitted.
   */
  allowedOrigins?: readonly string[];
}

/** Mint a random per-launch loopback token. Throws (never returns empty) if entropy is unavailable → the
 * transport then fails to construct/start rather than binding OPEN (SEC-001 fail-closed). */
function mintToken(): string {
  return randomBytes(32).toString('hex');
}

/** Host names that are always loopback (port stripped by the caller). IPv4 bind only, so `[::1]` inbound is
 * moot, but accepting it is harmless. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * RUNTIME-13: forced-terminate deadline for `stop()`. `WebSocketServer.close()` fires its callback only after
 * every client socket is gone, so a still-connected client would hang `stop()` forever. We send a close frame
 * (1001 "going away") to each client, then `terminate()` any socket still open at this deadline — the RFC 6455
 * + `ws` + drain-then-force convention (a WS close handshake completes in well under a second; 5s is generous).
 */
const WS_STOP_TERMINATE_DEADLINE_MS = 5000;

/** Strip the `:port` suffix from a Host/authority (port-agnostic — `bindWithRetry` can walk the port). */
function hostname(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  if (hostHeader.startsWith('[')) return hostHeader.slice(0, hostHeader.indexOf(']') + 1) || null;
  const colon = hostHeader.lastIndexOf(':');
  return colon === -1 ? hostHeader : hostHeader.slice(0, colon);
}

/** The upgrade `Host` must be a loopback name (port-agnostic) or an explicitly allowed host — closes DNS
 * rebinding. A missing `Host` is rejected (a well-formed HTTP/1.1 client always sends one). */
function hostAllowed(req: IncomingMessage, allowedHosts: ReadonlySet<string>): boolean {
  const host = hostname(req.headers.host);
  if (host === null) return false;
  return LOOPBACK_HOSTS.has(host) || allowedHosts.has(host);
}

/** A browser sends an unforgeable `Origin`; require it to be loopback or explicitly allowed. A non-browser
 * client omits `Origin` (allowed here — the token is its gate). Closes the browser drive-by hole. */
function originAllowed(req: IncomingMessage, allowedOrigins: ReadonlySet<string>): boolean {
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
function tokenMatches(expected: string, presented: string | null | undefined): boolean {
  if (!presented) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Read the presented token from the upgrade request: `?token=` query param, else the WS subprotocol. */
function presentedToken(req: IncomingMessage): string | null {
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

export class WsTransport implements IConfigurableTransport<IInteractiveSession> {
  readonly name = 'ws';
  readonly defaultEnabled = true;
  readonly optionsSchema = {
    port: { type: 'number', description: 'WebSocket server port', default: DEFAULT_PORT },
    maxRetries: {
      type: 'number',
      description: 'Port retry attempts when port is occupied',
      default: DEFAULT_MAX_RETRIES,
    },
  };

  private session: IInteractiveSession | null = null;
  private stopFn: (() => Promise<void>) | null = null;
  private readonly port: number;
  private readonly maxRetries: number;
  private readonly token?: string;
  private readonly allowedHosts: ReadonlySet<string>;
  private readonly allowedOrigins: ReadonlySet<string>;
  private resolvedPort?: number;

  constructor(config: IWsTransportConfig = {}) {
    this.port = config.port ?? DEFAULT_PORT;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    // SEC-001 secure-by-default: an explicit token wins; else auto-mint UNLESS `open` opts out. A failed
    // mint throws out of the constructor → the transport never binds OPEN (fail-closed).
    if (config.token) {
      this.token = config.token;
    } else if (!config.open) {
      this.token = mintToken();
    }
    this.allowedHosts = new Set(config.allowedHosts ?? []);
    this.allowedOrigins = new Set(config.allowedOrigins ?? []);
  }

  attach(session: IInteractiveSession): void {
    this.session = session;
  }

  /**
   * GUI-007: the actually-bound port after `start()` (may differ from the requested port — `bindWithRetry`
   * walks up on `EADDRINUSE`). `undefined` before start. A surface (e.g. `agent-cli --serve`) reads this to
   * point the served monitor's `ws-url` at the real port.
   */
  get boundPort(): number | undefined {
    return this.resolvedPort;
  }

  /**
   * SEC-001: the resolved auth token (explicit or auto-minted), or `undefined` in the discouraged `open`
   * mode. The surface reads this to deliver the token to the co-located client (a `0600` connection file /
   * the served monitor's injected `ws-url`). Never logged by the transport itself.
   */
  get resolvedToken(): string | undefined {
    return this.token;
  }

  async start(): Promise<void> {
    if (!this.session) throw new Error('WsTransport: attach() must be called before start()');
    const handle = await this.bindWithRetry(this.session, this.port, this.maxRetries);
    this.stopFn = handle.stop;
    this.resolvedPort = handle.port;
  }

  async stop(): Promise<void> {
    await this.stopFn?.();
    this.stopFn = null;
  }

  validateOptions(options: Record<string, TUniversalValue>): boolean {
    const { port, maxRetries } = options;
    if (port !== undefined && (typeof port !== 'number' || port < 1 || port > 65535)) return false;
    if (maxRetries !== undefined && (typeof maxRetries !== 'number' || maxRetries < 0))
      return false;
    return true;
  }

  private bindWithRetry(
    session: IInteractiveSession,
    port: number,
    retriesLeft: number,
  ): Promise<{ stop: () => Promise<void>; port: number }> {
    return this.tryBind(session, port).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && retriesLeft > 0)
        return this.bindWithRetry(session, port + 1, retriesLeft - 1);
      throw err;
    });
  }

  private tryBind(
    session: IInteractiveSession,
    port: number,
  ): Promise<{ stop: () => Promise<void>; port: number }> {
    return new Promise((resolve, reject) => {
      const httpServer: Server = createServer((_, res) => {
        res.writeHead(400).end('WebSocket endpoint');
      });

      httpServer.on('error', (err: NodeJS.ErrnoException) => {
        httpServer.close();
        reject(err);
      });

      const expectedToken = this.token;
      const allowedHosts = this.allowedHosts;
      const allowedOrigins = this.allowedOrigins;
      httpServer.listen(port, '127.0.0.1', () => {
        const wss = new WebSocketServer({
          server: httpServer,
          // SEC-001 defense-in-depth: reject a disallowed Host/Origin at the UPGRADE handshake (HTTP 403,
          // before the 101 protocol switch), independently of the token. Closes DNS-rebinding (Host) and the
          // browser drive-by hole (Origin) before any session data can be sent.
          verifyClient: (
            info: { origin: string; secure: boolean; req: IncomingMessage },
            cb: (res: boolean, code?: number, message?: string) => void,
          ) => {
            if (!hostAllowed(info.req, allowedHosts)) {
              cb(false, 403, 'Forbidden host');
              return;
            }
            if (!originAllowed(info.req, allowedOrigins)) {
              cb(false, 403, 'Forbidden origin');
              return;
            }
            cb(true);
          },
        });

        wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
          // REJECT BEFORE ANY SESSION DATA. When a token is required (explicit or SEC-001 auto-minted), an
          // unauthenticated connection is closed here — before the `messages` / `execution_workspace_event`
          // sends below — so a co-resident process/page cannot read history or answer prompts.
          if (expectedToken !== undefined && !tokenMatches(expectedToken, presentedToken(req))) {
            ws.close(1008, 'unauthorized');
            return;
          }

          const send = (message: TServerMessage): void => {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
          };

          const { onMessage, cleanup } = createWsHandler({ session, send });

          ws.on('message', (data) => onMessage(String(data)));
          ws.on('close', cleanup);
          ws.on('error', cleanup);

          send({ type: 'messages', messages: session.getMessages() });
          send({
            type: 'execution_workspace_event',
            snapshot: session.getExecutionWorkspaceSnapshot(),
          });
        });

        resolve({
          port,
          stop: () =>
            new Promise<void>((res) => {
              // RUNTIME-13: graceful-then-forced shutdown. Send a close frame to each client so well-behaved
              // peers close cleanly; terminate any socket still open at the deadline so `wss.close()`'s
              // all-clients-gone callback can never hang. `verifyClient`/token gates are connection-time and
              // untouched here (SEC-001 preserved).
              for (const client of wss.clients) client.close(1001, 'server shutting down');
              const deadline = setTimeout(() => {
                for (const client of wss.clients) client.terminate();
              }, WS_STOP_TERMINATE_DEADLINE_MS);
              wss.close(() => {
                clearTimeout(deadline);
                httpServer.close(() => res());
              });
            }),
        });
      });
    });
  }
}

/**
 * Self-contained WS transport implementing IConfigurableTransport.
 * Owns the WebSocket server lifecycle (ws package), started/stopped via the transport registry.
 */

import { timingSafeEqual } from 'node:crypto';
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
   * GUI-002: OPTIONAL loopback auth token. When set, every connection MUST present a matching token
   * (query param `?token=` or the `Sec-WebSocket-Protocol` subprotocol) or the socket is closed
   * BEFORE any session data is emitted. Unset (default, e.g. the local TUI path) = no auth, unchanged
   * behavior. The GUI-spawned sidecar sets this so a co-resident browser page cannot drive the session.
   */
  token?: string;
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
  private resolvedPort?: number;

  constructor(config: IWsTransportConfig = {}) {
    this.port = config.port ?? DEFAULT_PORT;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    if (config.token) this.token = config.token;
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
      httpServer.listen(port, '127.0.0.1', () => {
        const wss = new WebSocketServer({ server: httpServer });

        wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
          // GUI-002: REJECT BEFORE ANY SESSION DATA. When a token is configured, an unauthenticated
          // connection is closed here — before the `messages` / `execution_workspace_event` sends below —
          // so a co-resident browser page cannot read history or answer prompts on the open loopback port.
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
              wss.close(() => httpServer.close(() => res()));
            }),
        });
      });
    });
  }
}

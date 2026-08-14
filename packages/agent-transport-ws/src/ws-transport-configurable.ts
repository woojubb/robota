/**
 * Self-contained WS transport implementing IConfigurableTransport.
 * Owns the WebSocket server lifecycle (ws package), started/stopped via the transport registry.
 */

import { createServer, type IncomingMessage, type Server } from 'node:http';

import { createWsHandler } from '@robota-sdk/agent-transport-protocol';
import { WebSocketServer, WebSocket } from 'ws';

import { PayloadChannelRegistry } from './payload-channels.js';
import {
  hostAllowed,
  originAllowed,
  presentedToken,
  resolveWsAdmission,
  tokenMatches,
} from './ws-connection-guards.js';
import { DEFAULT_MAX_RETRIES, DEFAULT_PORT } from './ws-transport-config.js';

import type { IWsTransportConfig } from './ws-transport-config.js';
import type { TUniversalValue } from '@robota-sdk/agent-core';
import type {
  IChannelDescriptor,
  IConfigurableTransport,
  IInteractiveSession,
  ITransportLifecycleError,
  IPayloadChannel,
  IPayloadChannelHost,
  TChannelEventMap,
} from '@robota-sdk/agent-interface-transport';
import type { IProtocolSession, TServerMessage } from '@robota-sdk/agent-transport-protocol';
import type { RawData } from 'ws';

/**
 * RUNTIME-13: forced-terminate deadline for `stop()`. `WebSocketServer.close()` fires its callback only after
 * every client socket is gone, so a still-connected client would hang `stop()` forever. We send a close frame
 * (1001 "going away") to each client, then `terminate()` any socket still open at this deadline — the RFC 6455
 * + `ws` + drain-then-force convention (a WS close handshake completes in well under a second; 5s is generous).
 */
const WS_STOP_TERMINATE_DEADLINE_MS = 5000;

/**
 * Normalize the `ws` inbound payload shapes (Buffer | ArrayBuffer | Buffer[]) to a single
 * `Uint8Array` view. `ws` delivers a fragmented message as an array of Buffers.
 */
function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/**
 * TRANS-001: the WS transport is a payload-agnostic CARRIER that routes by WebSocket frame opcode —
 * TEXT frames go to the text-agent protocol profile (`createWsHandler`), BINARY frames go to the
 * consumer-declared channels. The two profiles share one connection and never constrain each other.
 */
export class WsTransport
  implements IConfigurableTransport<IInteractiveSession>, IPayloadChannelHost
{
  readonly name = 'ws';
  readonly lifecycle = Object.freeze({ kind: 'service' as const });
  readonly defaultEnabled = true;
  readonly optionsSchema = {
    port: { type: 'number', description: 'WebSocket server port', default: DEFAULT_PORT },
    maxRetries: {
      type: 'number',
      description: 'Port retry attempts when port is occupied',
      default: DEFAULT_MAX_RETRIES,
    },
  };

  private session: IProtocolSession | null = null;
  private stopFn: (() => Promise<void>) | null = null;
  private readonly port: number;
  private readonly maxRetries: number;
  private readonly token?: string;
  private readonly allowedHosts: ReadonlySet<string>;
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly channels = new PayloadChannelRegistry();
  private resolvedPort?: number;

  constructor(config: IWsTransportConfig = {}) {
    this.port = config.port ?? DEFAULT_PORT;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    // SEC-001/SEC-008: secure by default, decided by the shared seam rather than a copy here — see
    // SPEC § Transport Admission. A failed mint throws out of the constructor (fail-closed).
    const admission = resolveWsAdmission(config);
    if (admission.token !== null) this.token = admission.token;
    this.allowedHosts = new Set(config.allowedHosts ?? []);
    this.allowedOrigins = new Set(config.allowedOrigins ?? []);
  }

  attach(session: IInteractiveSession): void;
  attach(session: IProtocolSession): void;
  attach(session: IProtocolSession): void {
    this.session = session;
  }

  /**
   * TRANS-001: declare an app-level channel carried on this transport's connections. The channel's
   * events and opaque binary frames ride alongside the text-agent protocol on the SAME socket — the
   * transport never inspects the payloads. Register before or after `start()`; a channel opened
   * later is served by every already-connected client.
   */
  registerChannel<TEvents extends TChannelEventMap>(
    descriptor: IChannelDescriptor<TEvents>,
  ): IPayloadChannel<TEvents> {
    return this.channels.registerChannel(descriptor);
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
    if (!this.session) throw this.lifecycleError('not-attached');
    if (this.stopFn) throw this.lifecycleError('already-started');
    const handle = await this.bindWithRetry(this.session, this.port, this.maxRetries);
    this.stopFn = handle.stop;
    this.resolvedPort = handle.port;
  }

  async stop(): Promise<void> {
    await this.stopFn?.();
    this.stopFn = null;
    this.resolvedPort = undefined;
    this.session = null;
  }

  validateOptions(options: Record<string, TUniversalValue>): boolean {
    const { port, maxRetries } = options;
    if (port !== undefined && (typeof port !== 'number' || port < 1 || port > 65535)) return false;
    if (maxRetries !== undefined && (typeof maxRetries !== 'number' || maxRetries < 0))
      return false;
    return true;
  }

  private lifecycleError(code: ITransportLifecycleError['code']): ITransportLifecycleError {
    return Object.assign(new Error(`WsTransport ${code}.`), {
      name: 'TransportLifecycleError' as const,
      code,
      transportName: this.name,
    });
  }

  private bindWithRetry(
    session: IProtocolSession,
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
    session: IProtocolSession,
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
      const channels = this.channels;
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

          // TRANS-001: this connection becomes a sink for every declared channel's outbound frames.
          const detachSink = channels.addSink((frame: Uint8Array) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(frame, { binary: true });
          });
          const closeConnection = (): void => {
            detachSink();
            cleanup();
          };

          // Route by frame opcode: TEXT → the text-agent protocol profile, BINARY → the
          // payload-agnostic channels. An unroutable channel frame is answered with an explicit
          // `protocol_error` rather than silently dropped.
          ws.on('message', (data: RawData, isBinary: boolean) => {
            if (!isBinary) {
              onMessage(String(data));
              return;
            }
            const result = channels.receive(toBytes(data));
            if (!result.ok) send({ type: 'protocol_error', message: result.error });
          });
          ws.on('close', closeConnection);
          ws.on('error', closeConnection);

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

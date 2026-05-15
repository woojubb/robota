/**
 * Self-contained WS transport implementing IConfigurableTransport.
 * Owns the WebSocket server lifecycle (ws package), started/stopped via the transport registry.
 */

import { createServer, type Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { IInteractiveSession } from '@robota-sdk/agent-sdk';
import type { TUniversalValue } from '@robota-sdk/agent-core';
import type { IConfigurableTransport } from '@robota-sdk/agent-interface-transport';
import { createWsHandler } from './ws-handler.js';
import type { TServerMessage } from './ws-protocol.js';

const DEFAULT_PORT = 7070;
const DEFAULT_MAX_RETRIES = 20;

export interface IWsTransportConfig {
  port?: number;
  maxRetries?: number;
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

  constructor(config: IWsTransportConfig = {}) {
    this.port = config.port ?? DEFAULT_PORT;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  attach(session: IInteractiveSession): void {
    this.session = session;
  }

  async start(): Promise<void> {
    if (!this.session) throw new Error('WsTransport: attach() must be called before start()');
    const handle = await this.bindWithRetry(this.session, this.port, this.maxRetries);
    this.stopFn = handle.stop;
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
  ): Promise<{ stop: () => Promise<void> }> {
    return this.tryBind(session, port).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && retriesLeft > 0)
        return this.bindWithRetry(session, port + 1, retriesLeft - 1);
      throw err;
    });
  }

  private tryBind(
    session: IInteractiveSession,
    port: number,
  ): Promise<{ stop: () => Promise<void> }> {
    return new Promise((resolve, reject) => {
      const httpServer: Server = createServer((_, res) => {
        res.writeHead(400).end('WebSocket endpoint');
      });

      httpServer.on('error', (err: NodeJS.ErrnoException) => {
        httpServer.close();
        reject(err);
      });

      httpServer.listen(port, '127.0.0.1', () => {
        const wss = new WebSocketServer({ server: httpServer });

        wss.on('connection', (ws: WebSocket) => {
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
          stop: () =>
            new Promise<void>((res) => {
              wss.close(() => httpServer.close(() => res()));
            }),
        });
      });
    });
  }
}

/**
 * WebSocket binding for the {@link SignalingRelay} (REMOTE-002 Stage A, Step 3).
 *
 * This wraps each `ws` socket as an {@link ISignalingPeer} and delegates every frame to the content-blind relay.
 * It defaults to binding **loopback (`127.0.0.1`) on an ephemeral port (`0`)** so tests and local runs never
 * expose a network-reachable surface; a deployment would pass an explicit host/port. Stage A wires **no auth**
 * (Stage B adds pairing) and this server is NOT referenced by any publish/deploy path (TC-06).
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';

import { WebSocketServer, type WebSocket } from 'ws';

import { SignalingRelay, type ISignalingPeer, type ISignalingRelayOptions } from './relay.js';

export interface ISignalingServerOptions {
  /** Port to bind. Default `0` (ephemeral) — the actual port is reported by {@link ISignalingServerHandle.port}. */
  readonly port?: number;
  /** Host to bind. Default `127.0.0.1` (loopback) so no network-reachable surface is exposed by default. */
  readonly host?: string;
  /** Relay behavior — custom-auth hooks + abuse-control params (rate limit, TTL, caps). Defaults are safe. */
  readonly relay?: ISignalingRelayOptions;
}

export interface ISignalingServerHandle {
  /** The actual bound port (resolved even when `port: 0` was requested). */
  readonly port: number;
  /** The relay instance (diagnostics/tests). */
  readonly relay: SignalingRelay;
  /** Stop accepting connections and close the server. */
  close(): Promise<void>;
}

let peerCounter = 0;

function wrapSocket(socket: WebSocket, remoteAddress?: string): ISignalingPeer {
  const id = `peer_${(peerCounter += 1)}`;
  return {
    id,
    ...(remoteAddress ? { remoteAddress } : {}),
    send(raw: string): void {
      if (socket.readyState === socket.OPEN) socket.send(raw);
    },
    close(): void {
      socket.close();
    },
  };
}

/** Start the signaling relay over WebSocket. Resolves once the socket is listening (with the resolved port). */
export function startSignalingServer(
  options: ISignalingServerOptions = {},
): Promise<ISignalingServerHandle> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;
  const relay = new SignalingRelay(options.relay);

  const httpServer: Server = createServer();
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (socket: WebSocket, request: IncomingMessage) => {
    const peer = wrapSocket(socket, request.socket.remoteAddress);
    socket.on('message', (data: Buffer) => relay.handleFrame(peer, data.toString()));
    socket.on('close', () => relay.remove(peer));
    socket.on('error', () => relay.remove(peer));
  });

  return new Promise<ISignalingServerHandle>((resolve, reject) => {
    httpServer.on('error', reject);
    httpServer.listen(port, host, () => {
      const address = httpServer.address();
      const boundPort = typeof address === 'object' && address ? address.port : port;
      resolve({
        port: boundPort,
        relay,
        close(): Promise<void> {
          return new Promise<void>((res) => {
            // Force-terminate any live sockets first — otherwise `httpServer.close()` blocks waiting for open
            // WebSocket connections to end on their own.
            for (const client of wss.clients) client.terminate();
            wss.close(() => httpServer.close(() => res()));
          });
        },
      });
    });
  });
}

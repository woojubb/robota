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
import {
  DEFAULT_MAX_CONNECTIONS,
  DEFAULT_MAX_CONNECTIONS_PER_IP,
  DEFAULT_MAX_FRAME_BYTES,
} from './rate-limiter.js';

/**
 * Resolve the per-IP cap key from a connection's request (REMOTE-011 E2). Default reads the TCP peer
 * address; a `trustProxy` deployment reads a trusted `X-Forwarded-For` hop. Returning `undefined` maps to a
 * fixed sentinel so a missing address neither crashes nor bypasses the cap. Injectable so the server-level
 * test can present distinct source keys over loopback.
 */
export type TAddressResolver = (request: IncomingMessage) => string | undefined;

/** WebSocket close code for a connection refused by the total/per-IP cap (RFC 6455 1013 — Try Again Later). */
export const OVER_CAPACITY_CLOSE_CODE = 1013;

/** Sentinel per-IP key when the resolver yields `undefined` (keeps the cap applied without a crash). */
const UNKNOWN_SOURCE_KEY = 'unknown';

export interface ISignalingServerOptions {
  /** Port to bind. Default `0` (ephemeral) — the actual port is reported by {@link ISignalingServerHandle.port}. */
  readonly port?: number;
  /** Host to bind. Default `127.0.0.1` (loopback) so no network-reachable surface is exposed by default. */
  readonly host?: string;
  /** Relay behavior — custom-auth hooks + abuse-control params (rate limit, TTL, caps). Defaults are safe. */
  readonly relay?: ISignalingRelayOptions;
  /** Max bytes per WebSocket frame (REMOTE-011 E2; default {@link DEFAULT_MAX_FRAME_BYTES}). `ws` closes an oversized frame with 1009 before buffering it. */
  readonly maxFrameBytes?: number;
  /** Ceiling on total concurrent connections (REMOTE-011 E2; default {@link DEFAULT_MAX_CONNECTIONS}). */
  readonly maxConnections?: number;
  /** Ceiling on concurrent connections per resolved source key (REMOTE-011 E2; default {@link DEFAULT_MAX_CONNECTIONS_PER_IP}). `0` disables the per-IP cap (for proxy deployments that cannot supply a real client IP). */
  readonly maxConnectionsPerIp?: number;
  /** When true, resolve the per-IP key from a trusted `X-Forwarded-For` hop instead of the TCP address (REMOTE-011 E2). Assumes a single trusted proxy directly in front; ignored when a custom {@link ISignalingServerOptions.addressResolver} is supplied. */
  readonly trustProxy?: boolean;
  /** Custom per-IP key resolver (REMOTE-011 E2). Overrides `trustProxy`. Primarily a test seam for distinct source keys over loopback. */
  readonly addressResolver?: TAddressResolver;
}

export interface ISignalingServerHandle {
  /** The actual bound port (resolved even when `port: 0` was requested). */
  readonly port: number;
  /** The relay instance (diagnostics/tests). */
  readonly relay: SignalingRelay;
  /** Diagnostics only (REMOTE-011 E2): current live connection count — asserts the cap/counter memory bound. */
  readonly connectionCount: number;
  /** Stop accepting connections and close the server. */
  close(): Promise<void>;
}

let peerCounter = 0;

/** Default per-IP key: the TCP peer address (direct-exposure deployment). */
function directAddressResolver(request: IncomingMessage): string | undefined {
  return request.socket.remoteAddress;
}

/**
 * `trustProxy` per-IP key: the **right-most** `X-Forwarded-For` entry — the hop the single trusted proxy
 * directly in front appended (the left-most entry is client-forgeable, so it is never used). Falls back to
 * the TCP address when the header is absent. Assumes exactly one trusted proxy in front.
 */
function forwardedForResolver(request: IncomingMessage): string | undefined {
  const header = request.headers['x-forwarded-for'];
  const raw = Array.isArray(header) ? header[header.length - 1] : header;
  if (typeof raw === 'string') {
    const hops = raw
      .split(',')
      .map((h) => h.trim())
      .filter((h) => h.length > 0);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return request.socket.remoteAddress;
}

function selectResolver(options: ISignalingServerOptions): TAddressResolver {
  if (options.addressResolver) return options.addressResolver;
  return options.trustProxy ? forwardedForResolver : directAddressResolver;
}

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

  const maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
  const maxConnections = options.maxConnections ?? DEFAULT_MAX_CONNECTIONS;
  const maxConnectionsPerIp = options.maxConnectionsPerIp ?? DEFAULT_MAX_CONNECTIONS_PER_IP;
  const resolveSourceKey = selectResolver(options);

  // Connection-cap bookkeeping (REMOTE-011 E2): a total counter + a per-source-key counter map. A socket
  // that connects and never `join`s is otherwise invisible to the relay's per-source join bucket, so caps
  // are enforced here at accept time. The per-source map deletes a key when its count returns to 0 so it is
  // itself bounded by live connections.
  let totalConnections = 0;
  const perSourceConnections = new Map<string, number>();

  const httpServer: Server = createServer();
  // `maxPayload` makes `ws` reject an oversized frame with close code 1009 BEFORE buffering its body — an
  // application-layer size check cannot, because the body is already buffered by the time the relay sees it.
  const wss = new WebSocketServer({ server: httpServer, maxPayload: maxFrameBytes });

  wss.on('connection', (socket: WebSocket, request: IncomingMessage) => {
    const sourceKey = resolveSourceKey(request) ?? UNKNOWN_SOURCE_KEY;
    const perSource = perSourceConnections.get(sourceKey) ?? 0;
    // Refuse at accept — do NOT register the peer — when either ceiling is already met. `maxConnectionsPerIp`
    // of 0 disables the per-IP cap (proxy deployments that cannot supply a real client IP).
    if (
      totalConnections >= maxConnections ||
      (maxConnectionsPerIp > 0 && perSource >= maxConnectionsPerIp)
    ) {
      socket.close(OVER_CAPACITY_CLOSE_CODE, 'over-capacity');
      return;
    }

    totalConnections += 1;
    perSourceConnections.set(sourceKey, perSource + 1);

    const peer = wrapSocket(socket, request.socket.remoteAddress);
    let released = false;
    const release = (): void => {
      if (released) return; // close + error can both fire — decrement exactly once
      released = true;
      totalConnections -= 1;
      const remaining = (perSourceConnections.get(sourceKey) ?? 1) - 1;
      if (remaining <= 0) perSourceConnections.delete(sourceKey);
      else perSourceConnections.set(sourceKey, remaining);
      relay.remove(peer);
    };

    socket.on('message', (data: Buffer) => relay.handleFrame(peer, data.toString()));
    socket.on('close', release);
    socket.on('error', release);
  });

  return new Promise<ISignalingServerHandle>((resolve, reject) => {
    httpServer.on('error', reject);
    httpServer.listen(port, host, () => {
      const address = httpServer.address();
      const boundPort = typeof address === 'object' && address ? address.port : port;
      resolve({
        port: boundPort,
        relay,
        get connectionCount(): number {
          return totalConnections;
        },
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

/**
 * This device's direct signaling endpoint on the local network: a peer that found it (by the address
 * cache or mDNS) delivers mesh signals here instead of through a relay.
 *
 * It is a mailbox with a relay's rules and nothing more. It delivers only to the rotating pairwise
 * topics this device holds and treats every byte as hostile: frames and connections are bounded, a
 * connection that floods is closed, a browser page is turned away, and nothing that arrives here is
 * trusted — the peer is admitted by the device handshake over the WebRTC channel these signals set
 * up, or not at all.
 *
 * A topic never crosses the network. Frames are addressed by its hash, and an endpoint proves it
 * holds a topic by a MAC under the topic over the prober's nonce, so an endpoint that merely echoes
 * what it is sent, or replays what it overheard, cannot pass for the peer and capture the pair's
 * signals.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { WebSocketServer, type WebSocket } from 'ws';

/** A LAN address (a topic's hash) or a nonce: base64url. */
const LAN_ADDRESS = /^[A-Za-z0-9_-]{43}$/;
const NONCE = /^[A-Za-z0-9_-]{22}$/;
/** Largest frame accepted; an SDP with its candidates fits well within it. */
export const MAX_LAN_FRAME_BYTES = 64 * 1024;
const MAX_CONNECTIONS = 32;
/** Frames a connection may send per window before it is closed. */
const MAX_FRAMES_PER_WINDOW = 128;
const FRAME_WINDOW_MS = 10_000;
/** A connection that says nothing for this long is closed. */
const IDLE_MS = 120_000;
const POLICY_VIOLATION = 1008;

export interface IMeshLanListener {
  /** The port it listens on. */
  readonly port: number;
  /** Hold exactly these topics (replaces any earlier set). */
  setPresence(topics: readonly string[]): void;
  /** A signal delivered to a held topic, named by the topic. Returns an unsubscribe. */
  onMessage(handler: (topic: string, data: unknown) => void): () => void;
  close(): Promise<void>;
}

export interface IMeshLanListenerOptions {
  /** The port to listen on; when it is taken, any free port. Default: any free port. */
  readonly port?: number;
  /** The address to bind; default: every interface. */
  readonly host?: string;
}

/** Where frames for `topic` are addressed on the network. */
export function lanAddressOf(topic: string): string {
  return createHash('sha256').update(`lan-address:${topic}`).digest('base64url');
}

/** What an endpoint holding `topic` answers a probe carrying `nonce` with. */
export function lanPresenceProof(topic: string, nonce: string): string {
  return createHmac('sha256', topic).update(`lan-present:${nonce}`).digest('base64url');
}

/** Whether `proof` shows its sender holds `topic`. */
export function verifyLanPresenceProof(topic: string, nonce: string, proof: unknown): boolean {
  if (typeof proof !== 'string') return false;
  const expected = Buffer.from(lanPresenceProof(topic, nonce));
  const given = Buffer.from(proof);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function listen(port: number, host: string | undefined): Promise<WebSocketServer> {
  return new Promise((resolve, reject) => {
    const server = new WebSocketServer({
      port,
      ...(host !== undefined ? { host } : {}),
      maxPayload: MAX_LAN_FRAME_BYTES,
      perMessageDeflate: false,
      // A peer device sends no Origin; a browser always does, and no web page has business here.
      verifyClient: (info: { origin?: string }) => info.origin === undefined || info.origin === '',
    });
    const onError = (error: Error): void => {
      server.close();
      reject(error);
    };
    server.once('error', onError);
    server.once('listening', () => {
      server.off('error', onError);
      resolve(server);
    });
  });
}

function decodeFrame(
  raw: unknown,
): { type: string; to: string; nonce?: string; data?: unknown } | undefined {
  let frame: unknown;
  try {
    frame = JSON.parse(String(raw));
  } catch {
    return undefined;
  }
  if (typeof frame !== 'object' || frame === null || Array.isArray(frame)) return undefined;
  const r = frame as Record<string, unknown>;
  if (typeof r.type !== 'string' || typeof r.to !== 'string' || !LAN_ADDRESS.test(r.to)) {
    return undefined;
  }
  if (r.type === 'probe') {
    return typeof r.nonce === 'string' && NONCE.test(r.nonce)
      ? { type: r.type, to: r.to, nonce: r.nonce }
      : undefined;
  }
  return { type: r.type, to: r.to, data: r.data };
}

export async function startMeshLanListener(
  options: IMeshLanListenerOptions = {},
): Promise<IMeshLanListener> {
  let server: WebSocketServer;
  try {
    server = await listen(options.port ?? 0, options.host);
  } catch (error) {
    // allow-fallback: the remembered port is only a preference; any free port serves, peers find it again
    if (options.port === undefined || options.port === 0) throw error;
    server = await listen(0, options.host);
  }
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  /** Address → topic. */
  let held = new Map<string, string>();
  const handlers = new Set<(topic: string, data: unknown) => void>();

  server.on('connection', (socket: WebSocket) => {
    if (server.clients.size > MAX_CONNECTIONS) {
      socket.close(POLICY_VIOLATION);
      return;
    }
    let frames = 0;
    let windowStart = Date.now();
    let idle = setTimeout(() => socket.close(), IDLE_MS);
    idle.unref?.();
    socket.on('close', () => clearTimeout(idle));
    socket.on('error', () => socket.close());
    socket.on('message', (raw: unknown) => {
      const now = Date.now();
      if (now - windowStart > FRAME_WINDOW_MS) {
        windowStart = now;
        frames = 0;
      }
      frames += 1;
      if (frames > MAX_FRAMES_PER_WINDOW) {
        socket.close(POLICY_VIOLATION);
        return;
      }
      clearTimeout(idle);
      idle = setTimeout(() => socket.close(), IDLE_MS);
      idle.unref?.();
      const frame = decodeFrame(raw);
      if (frame === undefined) return;
      const topic = held.get(frame.to);
      if (topic === undefined) {
        socket.send(JSON.stringify({ type: 'absent', to: frame.to }));
        return;
      }
      if (frame.type === 'probe' && frame.nonce !== undefined) {
        socket.send(
          JSON.stringify({
            type: 'present',
            to: frame.to,
            nonce: frame.nonce,
            proof: lanPresenceProof(topic, frame.nonce),
          }),
        );
        return;
      }
      if (frame.type !== 'message') return;
      for (const handler of handlers) handler(topic, frame.data);
    });
  });

  return {
    port,
    setPresence(topics) {
      held = new Map(topics.map((topic) => [lanAddressOf(topic), topic]));
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    close() {
      handlers.clear();
      held = new Map();
      for (const client of server.clients) client.terminate();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

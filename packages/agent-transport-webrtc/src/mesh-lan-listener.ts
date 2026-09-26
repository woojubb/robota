/**
 * This device's direct signaling endpoint on the local network: a peer that found it (by the address
 * cache or mDNS) delivers mesh signals here instead of through a relay.
 *
 * It is a mailbox with a relay's rules and nothing more. It delivers only to the rotating pairwise
 * topics this device holds, answers whether a topic is held (the same thing a relay tells a sender),
 * and treats every byte as hostile: frames and connections are bounded, a connection that floods is
 * closed, and nothing that arrives here is trusted — the peer is admitted by the device handshake
 * over the WebRTC channel these signals set up, or not at all.
 */
import { WebSocketServer, type WebSocket } from 'ws';

/** A rotating LAN topic: a 256-bit pairwise tag, base64url. */
const LAN_TOPIC = /^[A-Za-z0-9_-]{43}$/;
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
  /** A signal delivered to a held topic. Returns an unsubscribe. */
  onMessage(handler: (topic: string, data: unknown) => void): () => void;
  close(): Promise<void>;
}

export interface IMeshLanListenerOptions {
  /** The port to listen on; when it is taken, any free port. Default: any free port. */
  readonly port?: number;
  /** The address to bind; default: every interface. */
  readonly host?: string;
}

function listen(port: number, host: string | undefined): Promise<WebSocketServer> {
  return new Promise((resolve, reject) => {
    const server = new WebSocketServer({
      port,
      ...(host !== undefined ? { host } : {}),
      maxPayload: MAX_LAN_FRAME_BYTES,
      perMessageDeflate: false,
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

function decodeFrame(raw: unknown): { type: string; topic: string; data?: unknown } | undefined {
  let frame: unknown;
  try {
    frame = JSON.parse(String(raw));
  } catch {
    return undefined;
  }
  if (typeof frame !== 'object' || frame === null || Array.isArray(frame)) return undefined;
  const r = frame as Record<string, unknown>;
  if (typeof r.type !== 'string' || typeof r.topic !== 'string' || !LAN_TOPIC.test(r.topic)) {
    return undefined;
  }
  return { type: r.type, topic: r.topic, data: r.data };
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
  let held = new Set<string>();
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
      const present = held.has(frame.topic);
      if (frame.type === 'probe' || !present) {
        socket.send(JSON.stringify({ type: present ? 'present' : 'absent', topic: frame.topic }));
        return;
      }
      if (frame.type !== 'message') return;
      for (const handler of handlers) handler(frame.topic, frame.data);
    });
  });

  return {
    port,
    setPresence(topics) {
      held = new Set(topics);
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    close() {
      handlers.clear();
      held = new Set();
      for (const client of server.clients) client.terminate();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

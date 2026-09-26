/**
 * The discovering relay on its own, over scripted endpoints: when a direct path is set aside, and for
 * how long.
 */
import type { IPairRendezvous } from '@robota-sdk/agent-remote-pairing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DiscoveringMeshRelay } from '../discovering-mesh-relay.js';
import type { IMeshCandidate, IMeshPeerRoute } from '../mesh-discovery.js';
import { lanAddressOf, lanPresenceProof, type IMeshLanListener } from '../mesh-lan-listener.js';
import type { IMeshRelay } from '../mesh-relay.js';
import type { IWebSocketLike } from '../ws-signaling-client.js';

const TAG = new Uint8Array(32).fill(7);
const LAN_TOPIC = Buffer.from(TAG).toString('base64url');
const ENDPOINT: IMeshCandidate = { host: '10.0.0.9', port: 4242 };
const ADMISSION_MS = 300;
const RECHECK_MS = 1_000;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const route: IMeshPeerRoute = {
  deviceId: 'peer-device',
  inbound: 'in-topic',
  outbound: 'out-topic',
  rendezvous: {
    tag: () => Promise.resolve(TAG),
    lookupTags: () => Promise.resolve([TAG]),
  } as unknown as IPairRendezvous,
};

const listener: IMeshLanListener = {
  port: 1,
  setPresence: () => undefined,
  onMessage: () => () => undefined,
  close: () => Promise.resolve(),
};

interface IFakeEndpoint {
  readonly probes: number;
  readonly signals: unknown[];
  readonly closed: number;
}

/** An endpoint that proves it holds the pair's topic and records what reaches it. */
function holdingEndpoint(): {
  endpoint: IFakeEndpoint;
  connect: (candidate: IMeshCandidate) => IWebSocketLike;
} {
  const endpoint = { probes: 0, signals: [] as unknown[], closed: 0 };
  const connect = (): IWebSocketLike => {
    const handlers = new Map<string, ((arg: unknown) => void)[]>();
    const emit = (event: string, arg?: unknown): void => {
      for (const handler of handlers.get(event) ?? []) handler(arg);
    };
    const socket: IWebSocketLike = {
      readyState: 0,
      send(raw) {
        const frame = JSON.parse(raw) as {
          type: string;
          to: string;
          nonce?: string;
          data?: unknown;
        };
        if (frame.type === 'probe') {
          endpoint.probes += 1;
          queueMicrotask(() =>
            emit(
              'message',
              JSON.stringify({
                type: 'present',
                to: lanAddressOf(LAN_TOPIC),
                proof: lanPresenceProof(LAN_TOPIC, frame.nonce ?? ''),
              }),
            ),
          );
          return;
        }
        endpoint.signals.push(frame.data);
      },
      close() {
        if (socket.readyState === 3) return;
        socket.readyState = 3;
        endpoint.closed += 1;
        emit('close');
      },
      on(event, handler) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
    };
    queueMicrotask(() => {
      socket.readyState = 1;
      emit('open');
    });
    return socket;
  };
  return { endpoint, connect };
}

function recordingRelay(): IMeshRelay & { readonly sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    sent,
    declarePresence: () => undefined,
    send: (_topic, data) => sent.push(data),
    onMessage: () => () => undefined,
    onAbsent: () => () => undefined,
    close: () => undefined,
  };
}

const hello = { v: 1, kind: 'hello', from: 'A'.repeat(22) };
const offer = {
  v: 1,
  kind: 'offer',
  from: 'A'.repeat(22),
  to: 'B'.repeat(22),
  cid: 'C'.repeat(22),
  sdp: 'x',
};
const ice = {
  v: 1,
  kind: 'ice',
  from: 'A'.repeat(22),
  to: 'B'.repeat(22),
  cid: 'C'.repeat(22),
  candidate: { candidate: 'c' },
};

function relayOver(connect: (candidate: IMeshCandidate) => IWebSocketLike, now: () => number) {
  const relay = recordingRelay();
  const discovering = new DiscoveringMeshRelay({
    relay,
    listener,
    sources: [{ candidates: () => Promise.resolve([ENDPOINT]) }],
    connect,
    admissionTimeoutMs: ADMISSION_MS,
    relayRecheckMs: RECHECK_MS,
    now,
  });
  cleanups.push(() => discovering.close());
  discovering.declarePeers([route]);
  return { relay, discovering };
}

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('the admission deadline of a direct path', () => {
  it('is not started by signals that trail an admitted attempt', async () => {
    const { endpoint, connect } = holdingEndpoint();
    const { relay, discovering } = relayOver(connect, Date.now);
    discovering.send(route.outbound, hello);
    await vi.waitFor(() => expect(endpoint.signals).toEqual([hello]));
    discovering.send(route.outbound, offer);
    discovering.confirmPeer(route.deviceId);

    // The admitted attempt's last candidates go out after the admission.
    discovering.send(route.outbound, ice);
    await settle(ADMISSION_MS * 2);
    discovering.send(route.outbound, ice);

    expect(endpoint.signals).toEqual([hello, offer, ice, ice]);
    expect(endpoint.closed).toBe(0);
    expect(relay.sent).toEqual([]);
  });

  it('is started by a new attempt after an admission, and sets the endpoint aside when it lapses', async () => {
    const { endpoint, connect } = holdingEndpoint();
    const { relay, discovering } = relayOver(connect, Date.now);
    discovering.send(route.outbound, hello);
    await vi.waitFor(() => expect(endpoint.signals).toEqual([hello]));
    discovering.confirmPeer(route.deviceId);

    discovering.send(route.outbound, offer);
    await vi.waitFor(() => expect(endpoint.closed).toBe(1));
    discovering.send(route.outbound, hello);
    expect(relay.sent).toEqual([hello]);
  });
});

describe('an endpoint that keeps failing', () => {
  it('is set aside for longer each time, rather than probed again every cycle', async () => {
    let now = Date.now();
    const { endpoint, connect } = holdingEndpoint();
    const { relay, discovering } = relayOver(connect, () => now);

    const failOnce = async (probes: number): Promise<void> => {
      discovering.send(route.outbound, hello);
      await vi.waitFor(() => expect(endpoint.probes).toBe(probes));
      await vi.waitFor(() => expect(endpoint.closed).toBe(probes));
    };
    await failOnce(1);
    // The relay carries the pair until the recheck; then the endpoint is tried again, and fails again.
    now += RECHECK_MS + 1;
    await failOnce(2);

    // One recheck later it is still set aside: the relay carries the pair without a probe.
    now += RECHECK_MS + 1;
    relay.sent.length = 0;
    discovering.send(route.outbound, hello);
    await vi.waitFor(() => expect(relay.sent).toEqual([hello]));
    expect(endpoint.probes).toBe(2);

    // Twice as long, and it is tried again.
    now += RECHECK_MS + 1;
    discovering.send(route.outbound, hello);
    await vi.waitFor(() => expect(endpoint.probes).toBe(3));
  });

  it('is trusted afresh once it carries an admission', async () => {
    let now = Date.now();
    const { endpoint, connect } = holdingEndpoint();
    const { discovering } = relayOver(connect, () => now);

    for (let failures = 1; failures <= 3; failures += 1) {
      discovering.send(route.outbound, hello);
      await vi.waitFor(() => expect(endpoint.closed).toBe(failures));
      now += RECHECK_MS * 2 ** failures + 1;
    }
    discovering.send(route.outbound, hello);
    await vi.waitFor(() => expect(endpoint.probes).toBe(4));
    discovering.confirmPeer(route.deviceId);
    endpoint.signals.length = 0;
    // A later failure starts the backoff over: one recheck period, not eight.
    discovering.send(route.outbound, offer);
    await vi.waitFor(() => expect(endpoint.closed).toBe(4));
    now += RECHECK_MS + 1;
    discovering.send(route.outbound, hello);
    await vi.waitFor(() => expect(endpoint.probes).toBe(5));
  });
});

/**
 * A mesh relay that looks for each peer itself before it falls back to a relay: the candidate
 * sources in order (the address cache, mDNS, then public records), each candidate probed at the
 * peer's direct signaling endpoint, and when none answers the signaling carriers in order (public
 * Nostr relays, then the self-hosted relay).
 *
 * Every way a signal can go is equally untrusted. Discovery only chooses where the signals of a
 * pair go; the node decodes whatever arrives as hostile input and admits a peer by the device
 * handshake alone, so a stale, forged or hijacked candidate can delay a connection but never admit
 * one. A candidate carries a pair's signals only once it proves it holds the pair's topic, and only
 * until an attempt over it fails to reach admission in time; then it is set aside and the next way
 * is tried, so a hostile endpoint cannot hold a pair off the relay. A carrier that is not the last one
 * is set aside the same way, so relays that drop signals cannot hold a pair off the next carrier. On
 * the local network signals are addressed by rotating pairwise tags rather than the relay's inbox
 * topics. A candidate is remembered only once a connection it carried was admitted.
 */
import { rendezvousEpoch, RENDEZVOUS_EPOCH_MS } from '@robota-sdk/agent-remote-pairing';
import WebSocket from 'ws';

import {
  addressCacheSource,
  createInMemoryMeshAddressCache,
  type IMeshAddressCache,
  type IMeshCandidate,
  type IMeshCandidateSource,
  type IMeshPeerRoute,
} from './mesh-discovery.js';
import {
  lanAddressOf,
  startMeshLanListener,
  verifyLanPresenceProof,
  type IMeshLanListener,
} from './mesh-lan-listener.js';
import { MeshMdns, type IMeshMdnsOptions } from './mesh-mdns.js';
import type { MeshDht } from './mesh-dht.js';
import type { IMeshRelay } from './mesh-relay.js';
import type { IWebSocketLike } from './ws-signaling-client.js';

const WS_OPEN = 1;
/** How long a candidate has to answer a probe. */
const DEFAULT_PROBE_TIMEOUT_MS = 1_500;
/** How long one candidate source may look. */
const DEFAULT_SOURCE_TIMEOUT_MS = 1_500;
/** After every candidate failed, the relay carries the pair's signals this long before looking again. */
const DEFAULT_RELAY_RECHECK_MS = 30_000;
/** Candidates probed per lookup, across all sources. */
const MAX_PROBES = 8;
/** Signals held for a pair while its way is being looked for. */
const MAX_QUEUED = 256;
/** A direct path that has not carried an admission in this long is set aside. */
const DEFAULT_ADMISSION_TIMEOUT_MS = 20_000;

/** Announces this device to its peers somewhere they look. */
export interface IMeshAdvertiser {
  advertise(routes: readonly IMeshPeerRoute[], port: number): Promise<void>;
  close(): void;
}

export interface IDiscoveringMeshRelayOptions {
  /**
   * The self-hosted relay: the last resort. Absent with no `signaling` either: a pair no candidate
   * reaches cannot be signaled.
   */
  readonly relay?: IMeshRelay;
  /** Public signaling carriers, tried in order before `relay` when no candidate answers. */
  readonly signaling?: readonly IMeshRelay[];
  /** This device's direct signaling endpoint. */
  readonly listener: IMeshLanListener;
  /** Where to look for a peer's endpoint, in order. */
  readonly sources: readonly IMeshCandidateSource[];
  /** Remembers candidates that carried an admitted connection. */
  readonly cache?: IMeshAddressCache;
  /** Told the peers and this device's endpoint port, to announce this device; closed with this relay. */
  readonly advertisers?: readonly IMeshAdvertiser[];
  /** Test seam: open a socket to a candidate. */
  readonly connect?: (candidate: IMeshCandidate) => IWebSocketLike;
  readonly probeTimeoutMs?: number;
  readonly sourceTimeoutMs?: number;
  readonly relayRecheckMs?: number;
  /** How long a direct path may carry signals without an admission before it is set aside. */
  readonly admissionTimeoutMs?: number;
  readonly onError?: (error: Error) => void;
  readonly now?: () => number;
}

type TPath =
  | { readonly kind: 'unresolved' }
  | { readonly kind: 'resolving'; readonly queue: unknown[] }
  | {
      readonly kind: 'direct';
      readonly socket: IWebSocketLike;
      readonly candidate: IMeshCandidate;
      /** Running from the first signal since the last admission until the next admission. */
      deadline?: ReturnType<typeof setTimeout>;
    }
  | {
      readonly kind: 'relay';
      readonly until: number;
      readonly carrier: IMeshRelay;
      /** Running from the first signal since the last admission, unless this is the last carrier. */
      deadline?: ReturnType<typeof setTimeout>;
    };

interface IRouteState {
  route: IMeshPeerRoute;
  /** The topic this device's signals to the peer go to on the local network, this epoch. */
  lanOut: string;
  path: TPath;
  /** Candidates set aside (`host:port` → until when), because they carried no admission. */
  readonly avoid: Map<string, number>;
  /** Carriers set aside (→ until when), because they carried no admission. */
  readonly avoidCarriers: Map<IMeshRelay, number>;
}

function candidateKey(candidate: IMeshCandidate): string {
  return `${candidate.host}:${candidate.port}`;
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

/** A pairwise tag as a LAN topic. */
function toLanTopic(tag: Uint8Array): string {
  return Buffer.from(tag).toString('base64url');
}

function candidateUrl(candidate: IMeshCandidate): string {
  const host = candidate.host.includes(':') ? `[${candidate.host}]` : candidate.host;
  return `ws://${host}:${candidate.port}`;
}

function parse(
  raw: unknown,
): { type?: unknown; to?: unknown; nonce?: unknown; proof?: unknown } | undefined {
  try {
    const frame: unknown = JSON.parse(String(raw));
    return typeof frame === 'object' && frame !== null
      ? (frame as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export class DiscoveringMeshRelay implements IMeshRelay {
  private readonly routes = new Map<string, IRouteState>();
  private readonly byDevice = new Map<string, IRouteState>();
  /** LAN topic → the relay inbox topic the node knows the pair by. */
  private lanIn = new Map<string, string>();
  private readonly messages = new Set<(topic: string, data: unknown) => void>();
  private readonly absents = new Set<(topic: string) => void>();
  private readonly unsubscribes: (() => void)[] = [];
  private readonly abort = new AbortController();
  private sync: Promise<void> = Promise.resolve();
  /** Peer declarations not yet in force; signals sent meanwhile wait for them, in order. */
  private pendingPeers = 0;
  private waiting: { readonly topic: string; readonly data: unknown }[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;

  public constructor(private readonly options: IDiscoveringMeshRelayOptions) {
    for (const carrier of this.carriers()) {
      this.unsubscribes.push(
        carrier.onMessage((topic, data) => this.deliver(topic, data)),
        carrier.onAbsent((topic) => this.absent(topic)),
      );
    }
    this.unsubscribes.push(
      options.listener.onMessage((lanTopic, data) => {
        const topic = this.lanIn.get(lanTopic);
        if (topic !== undefined) this.deliver(topic, data);
      }),
    );
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  /** Where a pair's signals go when no candidate answers, in order. */
  private carriers(): IMeshRelay[] {
    return [
      ...(this.options.signaling ?? []),
      ...(this.options.relay !== undefined ? [this.options.relay] : []),
    ];
  }

  private deliver(topic: string, data: unknown): void {
    if (this.closed) return;
    for (const handler of this.messages) handler(topic, data);
  }

  private absent(topic: string): void {
    if (this.closed) return;
    for (const handler of this.absents) handler(topic);
  }

  public declarePresence(topics: readonly string[]): void {
    for (const carrier of this.carriers()) carrier.declarePresence(topics);
  }

  public declarePeers(peers: readonly IMeshPeerRoute[]): void {
    for (const carrier of this.carriers()) carrier.declarePeers?.(peers);
    this.pendingPeers += 1;
    this.sync = this.sync
      .then(() => this.applyPeers(peers))
      .catch((error: unknown) => {
        this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
      })
      .finally(() => {
        this.pendingPeers -= 1;
        if (this.pendingPeers > 0) return;
        for (const { topic, data } of this.waiting.splice(0)) this.send(topic, data);
      });
  }

  /** Recompute the pairs' LAN topics for the current epoch and hold them. */
  private async applyPeers(peers: readonly IMeshPeerRoute[]): Promise<void> {
    if (this.closed) return;
    const epoch = rendezvousEpoch(this.now());
    const lanIn = new Map<string, string>();
    const next = new Map<string, IRouteState>();
    for (const route of peers) {
      const outbound = toLanTopic(await route.rendezvous.tag('lan-inbox', 'outbound', epoch));
      for (const tag of await route.rendezvous.lookupTags('lan-inbox', epoch)) {
        lanIn.set(toLanTopic(tag), route.inbound);
      }
      const held = this.routes.get(route.outbound);
      const state: IRouteState =
        held !== undefined && held.route.deviceId === route.deviceId
          ? held
          : {
              route,
              lanOut: outbound,
              path: { kind: 'unresolved' },
              avoid: new Map(),
              avoidCarriers: new Map(),
            };
      state.route = route;
      state.lanOut = outbound;
      next.set(route.outbound, state);
    }
    if (this.closed) return;
    for (const [topic, state] of this.routes) {
      if (next.get(topic) !== state) this.reset(state);
    }
    this.routes.clear();
    this.byDevice.clear();
    for (const [topic, state] of next) {
      this.routes.set(topic, state);
      this.byDevice.set(state.route.deviceId, state);
    }
    this.lanIn = lanIn;
    this.options.listener.setPresence([...lanIn.keys()]);
    this.cacheWrite(() => this.options.cache?.retain(peers.map((p) => p.deviceId)));
    await Promise.all(
      (this.options.advertisers ?? []).map((a) => a.advertise(peers, this.options.listener.port)),
    );
    if (this.closed) return;
    this.scheduleEpoch(epoch, peers);
  }

  private scheduleEpoch(epoch: number, peers: readonly IMeshPeerRoute[]): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    const delay = Math.max(0, (epoch + 1) * RENDEZVOUS_EPOCH_MS - this.now());
    this.timer = setTimeout(() => this.declarePeers(peers), delay);
    this.timer.unref?.();
  }

  public confirmPeer(deviceId: string): void {
    const state = this.byDevice.get(deviceId);
    const path = state?.path;
    if (state === undefined || (path?.kind !== 'direct' && path?.kind !== 'relay')) return;
    clearTimeout(path.deadline);
    path.deadline = undefined;
    if (path.kind === 'relay') {
      state.avoidCarriers.clear();
      return;
    }
    state.avoid.clear();
    this.cacheWrite(() => this.options.cache?.remember(deviceId, path.candidate));
  }

  /** A cache that cannot be written costs the next connection a lookup, nothing more. */
  private cacheWrite(write: () => void): void {
    try {
      write();
    } catch (error) {
      this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  public send(topic: string, data: unknown): void {
    if (this.closed) return;
    if (this.pendingPeers > 0) {
      // The pair may be one being declared right now: route it once it is.
      if (this.waiting.length < MAX_QUEUED) this.waiting.push({ topic, data });
      else this.viaRelay(topic, data);
      return;
    }
    const state = this.routes.get(topic);
    if (state === undefined) {
      this.viaRelay(topic, data);
      return;
    }
    const path = state.path;
    if (path.kind === 'direct' && path.socket.readyState === WS_OPEN) {
      // Every attempt must reach admission over this endpoint in time, not only the first one.
      this.armDeadline(state, path);
      this.sendDirect(path.socket, state, data);
      return;
    }
    if (path.kind === 'relay' && this.now() < path.until) {
      this.viaCarrier(state, path, data);
      return;
    }
    if (path.kind === 'resolving') {
      if (path.queue.length < MAX_QUEUED) path.queue.push(data);
      else this.viaRelay(topic, data);
      return;
    }
    if (path.kind === 'direct') this.reset(state);
    const queue = [data];
    state.path = { kind: 'resolving', queue };
    void this.resolve(state, queue);
  }

  private sendDirect(socket: IWebSocketLike, state: IRouteState, data: unknown): void {
    socket.send(JSON.stringify({ type: 'message', to: lanAddressOf(state.lanOut), data }));
  }

  /** A signal for a topic that is no declared pair's: the last carrier, if there is one. */
  private viaRelay(topic: string, data: unknown): void {
    const carrier = this.carriers().at(-1);
    if (carrier === undefined) {
      queueMicrotask(() => this.absent(topic));
      return;
    }
    carrier.send(topic, data);
  }

  private viaCarrier(
    state: IRouteState,
    path: Extract<TPath, { kind: 'relay' }>,
    data: unknown,
  ): void {
    // Every attempt must reach admission over this carrier in time, unless it is the last one.
    if (path.carrier !== this.carriers().at(-1)) this.armDeadline(state, path);
    path.carrier.send(state.route.outbound, data);
  }

  /** Try the sources in order; the first candidate that holds the pair's topic carries its signals. */
  private async resolve(state: IRouteState, queue: unknown[]): Promise<void> {
    const tried = new Set<string>();
    const now = this.now();
    for (const [key, until] of state.avoid) if (until <= now) state.avoid.delete(key);
    for (const source of this.options.sources) {
      if (this.closed || state.path.kind !== 'resolving') return;
      for (const candidate of await this.look(source, state.route)) {
        const key = candidateKey(candidate);
        if (tried.size >= MAX_PROBES) break;
        if (tried.has(key) || state.avoid.has(key)) continue;
        tried.add(key);
        const socket = await this.probe(candidate, state.lanOut);
        if (socket === undefined) continue;
        if (
          this.closed ||
          state.path.kind !== 'resolving' ||
          this.routes.get(state.route.outbound) !== state
        ) {
          socket.close();
          return;
        }
        this.useDirect(state, socket, candidate);
        for (const data of queue) this.sendDirect(socket, state, data);
        return;
      }
    }
    if (this.closed || state.path.kind !== 'resolving') return;
    this.fallBack(state);
    const path = state.path as TPath;
    for (const data of queue) {
      if (path.kind === 'relay') this.viaCarrier(state, path, data);
      else this.viaRelay(state.route.outbound, data);
    }
  }

  /**
   * The first carrier not set aside carries the pair's signals for a while (the last one when all
   * are). Without a carrier there is nothing to wait on: the next signal looks again, since the
   * peer's endpoint may simply not have been up yet.
   */
  private fallBack(state: IRouteState): void {
    const now = this.now();
    for (const [carrier, until] of state.avoidCarriers) {
      if (until <= now) state.avoidCarriers.delete(carrier);
    }
    const carriers = this.carriers();
    const carrier = carriers.find((c) => !state.avoidCarriers.has(c)) ?? carriers.at(-1);
    state.path =
      carrier === undefined
        ? { kind: 'unresolved' }
        : { kind: 'relay', until: now + this.recheckMs(), carrier };
  }

  private recheckMs(): number {
    return this.options.relayRecheckMs ?? DEFAULT_RELAY_RECHECK_MS;
  }

  private async look(
    source: IMeshCandidateSource,
    route: IMeshPeerRoute,
  ): Promise<readonly IMeshCandidate[]> {
    const timeout = AbortSignal.timeout(
      source.timeoutMs ?? this.options.sourceTimeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS,
    );
    const signal = AbortSignal.any([timeout, this.abort.signal]);
    try {
      return await Promise.race([
        source.candidates(route, signal),
        new Promise<readonly IMeshCandidate[]>((resolve) =>
          signal.addEventListener('abort', () => resolve([]), { once: true }),
        ),
      ]);
    } catch {
      // allow-fallback: a source that fails has no candidates; the next source, then the relay, is tried
      return [];
    }
  }

  /** A socket to `candidate` once it proves it holds `lanTopic`; `undefined` otherwise. */
  private probe(candidate: IMeshCandidate, lanTopic: string): Promise<IWebSocketLike | undefined> {
    const to = lanAddressOf(lanTopic);
    const nonce = randomNonce();
    return new Promise((resolve) => {
      let socket: IWebSocketLike;
      try {
        socket = (
          this.options.connect ??
          ((c) => new WebSocket(candidateUrl(c), { maxPayload: 4096 }) as unknown as IWebSocketLike)
        )(candidate);
      } catch {
        resolve(undefined);
        return;
      }
      let settled = false;
      const settle = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!ok) socket.close();
        resolve(ok ? socket : undefined);
      };
      const timer = setTimeout(
        () => settle(false),
        this.options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
      );
      timer.unref?.();
      socket.on('open', () => socket.send(JSON.stringify({ type: 'probe', to, nonce })));
      socket.on('message', (raw) => {
        const frame = parse(raw);
        if (frame?.to !== to) return;
        if (frame.type === 'present' && frame.nonce === nonce) {
          settle(verifyLanPresenceProof(lanTopic, nonce, frame.proof));
        } else if (frame.type === 'absent') {
          settle(false);
        }
      });
      socket.on('error', () => settle(false));
      socket.on('close', () => settle(false));
    });
  }

  /**
   * An endpoint or carrier that carries the pair's signals but no admission is set aside, so it
   * cannot keep the pair from the next way — whether it never forwarded, or forwarded one attempt
   * and swallows the next.
   */
  private armDeadline(
    state: IRouteState,
    path: Extract<TPath, { kind: 'direct' } | { kind: 'relay' }>,
  ): void {
    if (path.deadline !== undefined) return;
    path.deadline = setTimeout(() => {
      if (state.path !== path) return;
      const until = this.now() + this.recheckMs();
      if (path.kind === 'direct') state.avoid.set(candidateKey(path.candidate), until);
      else state.avoidCarriers.set(path.carrier, until);
      this.reset(state);
      this.fallBack(state);
    }, this.options.admissionTimeoutMs ?? DEFAULT_ADMISSION_TIMEOUT_MS);
    path.deadline.unref?.();
  }

  private useDirect(state: IRouteState, socket: IWebSocketLike, candidate: IMeshCandidate): void {
    const path: Extract<TPath, { kind: 'direct' }> = { kind: 'direct', socket, candidate };
    state.path = path;
    this.armDeadline(state, path);
    const drop = (): void => {
      if (state.path === path) this.reset(state);
    };
    socket.on('close', drop);
    socket.on('error', drop);
    // The endpoint no longer holds the pair's topic (the peer restarted, or it is someone else now).
    socket.on('message', (raw) => {
      const frame = parse(raw);
      if (frame?.type === 'absent' && frame.to === lanAddressOf(state.lanOut)) drop();
    });
  }

  private reset(state: IRouteState): void {
    const path = state.path;
    state.path = { kind: 'unresolved' };
    if (path.kind === 'relay') clearTimeout(path.deadline);
    if (path.kind === 'direct') {
      clearTimeout(path.deadline);
      path.socket.close();
    }
  }

  public onMessage(handler: (topic: string, data: unknown) => void): () => void {
    this.messages.add(handler);
    return () => this.messages.delete(handler);
  }

  public onAbsent(handler: (topic: string) => void): () => void {
    this.absents.add(handler);
    return () => this.absents.delete(handler);
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.abort.abort();
    if (this.timer !== undefined) clearTimeout(this.timer);
    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    for (const state of this.routes.values()) this.reset(state);
    this.routes.clear();
    this.byDevice.clear();
    this.messages.clear();
    this.absents.clear();
    this.waiting = [];
    for (const advertiser of this.options.advertisers ?? []) advertiser.close();
    // allow-fallback: closing the endpoint is best effort once this relay is done with it
    void this.options.listener.close().catch(() => undefined);
    // The carriers it was given stay the caller's to close, as a relay handed to a node does.
  }
}

export interface IStartLanMeshRelayOptions {
  /** The self-hosted relay: the last carrier. */
  readonly relay?: IMeshRelay;
  /**
   * Beyond the local network: public records to find peers by (closed with the relay), and public
   * signaling carriers tried before the self-hosted relay (the caller's to close).
   */
  readonly internet?: {
    readonly dht?: MeshDht;
    readonly signaling?: readonly IMeshRelay[];
  };
  /** Default: one that lives as long as the process. */
  readonly cache?: IMeshAddressCache;
  /** The address the direct signaling endpoint binds; default: every interface. */
  readonly host?: string;
  /** mDNS options, or `false` for none (the cache and the relay still work). */
  readonly mdns?: IMeshMdnsOptions | false;
  readonly onError?: (error: Error) => void;
}

/**
 * A {@link DiscoveringMeshRelay} over this device's direct signaling endpoint, looking for peers in
 * the address cache, with mDNS, then in public records, and signaling through the public carriers,
 * then the self-hosted relay, when no candidate answers.
 */
export async function startLanMeshRelay(
  options: IStartLanMeshRelayOptions = {},
): Promise<DiscoveringMeshRelay> {
  const cache = options.cache ?? createInMemoryMeshAddressCache();
  const lastPort = cache.lastListenPort();
  const listener = await startMeshLanListener({
    ...(lastPort !== undefined ? { port: lastPort } : {}),
    ...(options.host !== undefined ? { host: options.host } : {}),
  });
  try {
    cache.rememberListenPort(listener.port);
  } catch (error) {
    // allow-fallback: a port that cannot be remembered only means peers look this device up again
    options.onError?.(error instanceof Error ? error : new Error(String(error)));
  }
  const mdns =
    options.mdns === false
      ? undefined
      : new MeshMdns({
          ...(options.onError !== undefined ? { onError: options.onError } : {}),
          ...options.mdns,
        });
  const dht = options.internet?.dht;
  const signaling = options.internet?.signaling ?? [];
  return new DiscoveringMeshRelay({
    ...(options.relay !== undefined ? { relay: options.relay } : {}),
    ...(signaling.length > 0 ? { signaling } : {}),
    listener,
    sources: [
      addressCacheSource(cache),
      ...(mdns !== undefined ? [mdns] : []),
      ...(dht !== undefined ? [dht] : []),
    ],
    cache,
    advertisers: [...(mdns !== undefined ? [mdns] : []), ...(dht !== undefined ? [dht] : [])],
    ...(options.onError !== undefined ? { onError: options.onError } : {}),
  });
}

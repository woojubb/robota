/**
 * A mesh relay that looks for each peer itself before it falls back to the self-hosted relay: the
 * candidate sources in order (the address cache, then mDNS), each candidate probed at the peer's
 * direct signaling endpoint, and the relay when none answers.
 *
 * Every way a signal can go is equally untrusted. Discovery only chooses where the signals of a
 * pair go; the node decodes whatever arrives as hostile input and admits a peer by the device
 * handshake alone, so a stale, forged or hijacked candidate can delay a connection but never admit
 * one. A candidate carries a pair's signals only once it proves it holds the pair's topic, and only
 * until an attempt over it fails to reach admission in time; then it is set aside and the next way
 * is tried, so a hostile endpoint cannot hold a pair off the relay. On the local network signals are
 * addressed by rotating pairwise tags rather than the relay's inbox topics. A candidate is
 * remembered only once a connection it carried was admitted.
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

export interface IDiscoveringMeshRelayOptions {
  /** The self-hosted relay: the last resort. Absent: a pair no candidate reaches cannot be signaled. */
  readonly relay?: IMeshRelay;
  /** This device's direct signaling endpoint. */
  readonly listener: IMeshLanListener;
  /** Where to look for a peer's endpoint, in order. */
  readonly sources: readonly IMeshCandidateSource[];
  /** Remembers candidates that carried an admitted connection. */
  readonly cache?: IMeshAddressCache;
  /** Told the peers and this device's endpoint port, to announce this device to them. */
  readonly advertiser?: {
    advertise(routes: readonly IMeshPeerRoute[], port: number): Promise<void>;
    close(): void;
  };
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
  | { readonly kind: 'relay'; readonly until: number };

interface IRouteState {
  route: IMeshPeerRoute;
  /** The topic this device's signals to the peer go to on the local network, this epoch. */
  lanOut: string;
  path: TPath;
  /** Candidates set aside (`host:port` → until when), because they carried no admission. */
  readonly avoid: Map<string, number>;
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
    const relay = options.relay;
    if (relay !== undefined) {
      this.unsubscribes.push(
        relay.onMessage((topic, data) => this.deliver(topic, data)),
        relay.onAbsent((topic) => this.absent(topic)),
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

  private deliver(topic: string, data: unknown): void {
    if (this.closed) return;
    for (const handler of this.messages) handler(topic, data);
  }

  private absent(topic: string): void {
    if (this.closed) return;
    for (const handler of this.absents) handler(topic);
  }

  public declarePresence(topics: readonly string[]): void {
    this.options.relay?.declarePresence(topics);
  }

  public declarePeers(peers: readonly IMeshPeerRoute[]): void {
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
          : { route, lanOut: outbound, path: { kind: 'unresolved' }, avoid: new Map() };
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
    await this.options.advertiser?.advertise(peers, this.options.listener.port);
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
    if (state === undefined || path?.kind !== 'direct') return;
    clearTimeout(path.deadline);
    path.deadline = undefined;
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
      this.viaRelay(topic, data);
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

  private viaRelay(topic: string, data: unknown): void {
    const relay = this.options.relay;
    if (relay === undefined) {
      queueMicrotask(() => this.absent(topic));
      return;
    }
    relay.send(topic, data);
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
    for (const data of queue) this.viaRelay(state.route.outbound, data);
  }

  /**
   * The relay carries the pair's signals for a while. Without a relay there is nothing to wait on:
   * the next signal looks again, since the peer's endpoint may simply not have been up yet.
   */
  private fallBack(state: IRouteState): void {
    state.path =
      this.options.relay === undefined
        ? { kind: 'unresolved' }
        : { kind: 'relay', until: this.now() + this.recheckMs() };
  }

  private recheckMs(): number {
    return this.options.relayRecheckMs ?? DEFAULT_RELAY_RECHECK_MS;
  }

  private async look(
    source: IMeshCandidateSource,
    route: IMeshPeerRoute,
  ): Promise<readonly IMeshCandidate[]> {
    const timeout = AbortSignal.timeout(this.options.sourceTimeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS);
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
   * An endpoint that carries the pair's signals but no admission is set aside, so it cannot keep the
   * pair from the next candidate or the relay — whether it never forwarded, or forwarded one
   * attempt and swallows the next.
   */
  private armDeadline(state: IRouteState, path: Extract<TPath, { kind: 'direct' }>): void {
    if (path.deadline !== undefined) return;
    path.deadline = setTimeout(() => {
      if (state.path !== path) return;
      state.avoid.set(candidateKey(path.candidate), this.now() + this.recheckMs());
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
    this.options.advertiser?.close();
    // allow-fallback: closing the endpoint is best effort once this relay is done with it
    void this.options.listener.close().catch(() => undefined);
    // The relay it was given stays the caller's to close, as a relay handed to a node does.
  }
}

export interface IStartLanMeshRelayOptions {
  /** The self-hosted relay, tried after the local network. */
  readonly relay?: IMeshRelay;
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
 * the address cache, then with mDNS, then on the relay.
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
  return new DiscoveringMeshRelay({
    ...(options.relay !== undefined ? { relay: options.relay } : {}),
    listener,
    sources: mdns !== undefined ? [addressCacheSource(cache), mdns] : [addressCacheSource(cache)],
    cache,
    ...(mdns !== undefined ? { advertiser: mdns } : {}),
    ...(options.onError !== undefined ? { onError: options.onError } : {}),
  });
}

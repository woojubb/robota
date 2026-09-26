/**
 * Finding a peer device beyond the local network through records on public infrastructure (the
 * Mainline DHT, or pkarr relays in front of it), and handing on the newest device lists the same way.
 *
 * For every peer this device publishes, under `dir(self → peer)` and the current epoch:
 * - its connection hints: the addresses of its direct signaling endpoint;
 * - the newest device revocation lists it holds, so a peer can learn of a revocation from any other
 *   device of the pair set before it admits someone.
 *
 * Each record is signed by a one-time key of that pair, direction, epoch and purpose, stored under a
 * rotating salt, and sealed by the pair; its plaintext is padded to a fixed size. Publish times are
 * jittered per pair, so the records one device publishes do not appear together. A lookup reads
 * `dir(peer → self)` at the current epoch and the adjacent ones.
 *
 * What a lookup yields is a candidate or an unverified list, never trust: candidates only carry
 * signals, and lists are verified by the device handshake before anything uses them.
 */
import {
  rendezvousEpoch,
  type IDeviceRevocationList,
  type ISigningKeyRevocation,
} from '@robota-sdk/agent-remote-pairing';

import {
  chunkCount,
  chunkJson,
  decodeHints,
  decodeRelayHints,
  encodeHints,
  itemAddress,
  joinChunks,
  publishJitter,
} from './mesh-records.js';

import type { IMeshCandidate, IMeshCandidateSource, IMeshPeerRoute } from './mesh-discovery.js';
import type { IRendezvousItemStore } from './mesh-item-store.js';

/** Longest delay before a pair's records are published, by default. */
export const DEFAULT_MAX_PUBLISH_JITTER_MS = 90_000;
/** How long a DHT lookup may take, by default: iterative lookups take seconds. */
const DEFAULT_LOOKUP_TIMEOUT_MS = 6_000;
/** Peers whose list records a freshness lookup reads. */
const MAX_LIST_PEERS = 16;
/** Candidates of one list kind a freshness lookup returns. */
const MAX_LIST_CANDIDATES = 16;
/** Candidates of one list kind taken from one peer's records. */
const MAX_LIST_CANDIDATES_PER_PEER = 2;
/** How long "no relay" found for a peer holds before its records are looked up again. */
const NO_RELAY_RECHECK_MS = 2 * 60 * 1000;
/** How long a background lookup of the lists may take. */
const PREFETCH_TIMEOUT_MS = 30_000;

/** The device lists this device hands on to its peers. */
export interface IPublishedLists {
  readonly revocation: IDeviceRevocationList;
  readonly signingKeyRevocation?: ISigningKeyRevocation;
}

/** What a freshness lookup found, as received, newest first: each candidate is verified before use. */
export interface IFetchedLists {
  readonly revocation?: readonly unknown[];
  readonly signingKeyRevocation?: readonly unknown[];
}

export interface IMeshDhtOptions {
  /** Where records go and come from; every one is written to and read from. */
  readonly stores: readonly IRendezvousItemStore[];
  /** This device's addresses to publish with its endpoint port. */
  readonly addresses: () => readonly string[];
  /** Where this device's relay listens, published to each paired device with its hints; none: no relay. */
  readonly relayEndpoints?: () => readonly IMeshCandidate[];
  /** The newest lists this device holds; absent or `undefined`: no list records are published. */
  readonly lists?: () => IPublishedLists | undefined;
  readonly maxPublishJitterMs?: number;
  /** How long a candidate lookup may take. */
  readonly lookupTimeoutMs?: number;
  readonly random?: () => number;
  readonly now?: () => number;
  /** A record could not be published; lookups still run. */
  readonly onError?: (error: Error) => void;
}

interface IScheduled {
  readonly timer: ReturnType<typeof setTimeout>;
  readonly epoch: number;
  readonly port: number;
}

function seqOf(value: unknown): number {
  if (typeof value !== 'object' || value === null) return -1;
  const seq = (value as { seq?: unknown }).seq;
  return typeof seq === 'number' && Number.isSafeInteger(seq) ? seq : -1;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export class MeshDht implements IMeshCandidateSource {
  public readonly timeoutMs: number;
  private readonly scheduled = new Map<string, IScheduled>();
  private routes: readonly IMeshPeerRoute[] = [];
  /** The lists found by the last lookup that finished, for a lookup that runs out of time. */
  private listsFound: IFetchedLists | undefined;
  private prefetchedEpoch?: number;
  /** The relays peers advertised, by device: the epoch and time they were looked up. */
  private readonly relaysFound = new Map<
    string,
    {
      readonly epoch: number;
      readonly checkedAt: number;
      readonly endpoints: readonly IMeshCandidate[];
    }
  >();
  /** Relay lookups running, by device. */
  private readonly relayLookups = new Map<string, Promise<void>>();
  private closed = false;

  public constructor(private readonly options: IMeshDhtOptions) {
    this.timeoutMs = options.lookupTimeoutMs ?? DEFAULT_LOOKUP_TIMEOUT_MS;
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  /** The peer's endpoint addresses from its hints record, at this epoch or an adjacent one. */
  public async candidates(
    peer: IMeshPeerRoute,
    signal: AbortSignal,
  ): Promise<readonly IMeshCandidate[]> {
    const epoch = rendezvousEpoch(this.now());
    const found = await this.lookup(peer, 'hints', epoch, signal);
    // A lookup cut short says nothing about a relay.
    if (!signal.aborted) this.rememberRelays(peer, epoch, found);
    const out: IMeshCandidate[] = [];
    const seen = new Set<string>();
    // Newest epoch first: its addresses are the likeliest to be current.
    for (const record of found.sort((a, b) => b.epoch - a.epoch)) {
      for (const candidate of decodeHints(record.data)) {
        const key = `${candidate.host}:${candidate.port}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(candidate);
      }
    }
    return out;
  }

  /** The relay endpoints in the newest of `found`, the peer's hints records. */
  private rememberRelays(
    peer: IMeshPeerRoute,
    epoch: number,
    found: readonly { readonly epoch: number; readonly data: Uint8Array }[],
  ): void {
    const newest = [...found].sort((a, b) => b.epoch - a.epoch)[0];
    const endpoints = newest === undefined ? [] : decodeRelayHints(newest.data);
    this.relaysFound.set(peer.deviceId, { epoch, checkedAt: this.now(), endpoints });
  }

  /**
   * The relays `peers` advertise to this device, by device id. What a lookup found holds for the
   * epoch, and "no relay" for a short while, so connection attempts do not wait on lookups; a
   * lookup still running when `signal` ends goes on, and the next call has its answer. Only a
   * peer's own sealed hints record says where its relay is, so no one else learns it and no one
   * else can plant one.
   */
  public async relayAdverts(
    peers: readonly IMeshPeerRoute[],
    signal: AbortSignal,
  ): Promise<ReadonlyMap<string, readonly IMeshCandidate[]>> {
    const now = this.now();
    const epoch = rendezvousEpoch(now);
    const routes = peers.slice(0, MAX_LIST_PEERS);
    const running: Promise<void>[] = [];
    for (const route of routes) {
      const known = this.relaysFound.get(route.deviceId);
      const fresh =
        known !== undefined &&
        known.epoch === epoch &&
        (known.endpoints.length > 0 || now - known.checkedAt < NO_RELAY_RECHECK_MS);
      if (fresh) continue;
      running.push(this.lookUpRelay(route, epoch));
    }
    if (running.length > 0) {
      const ended = new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      await Promise.race([Promise.all(running), ended]);
    }
    const current = new Set(peers.map((route) => route.deviceId));
    for (const deviceId of [...this.relaysFound.keys()]) {
      if (!current.has(deviceId)) this.relaysFound.delete(deviceId);
    }
    const out = new Map<string, readonly IMeshCandidate[]>();
    for (const route of routes) {
      const endpoints = this.relaysFound.get(route.deviceId)?.endpoints ?? [];
      if (endpoints.length > 0) out.set(route.deviceId, endpoints);
    }
    return out;
  }

  /** One lookup of a peer's relay at a time, bounded by the lookup timeout, not by any caller. */
  private lookUpRelay(route: IMeshPeerRoute, epoch: number): Promise<void> {
    const held = this.relayLookups.get(route.deviceId);
    if (held !== undefined) return held;
    const signal = AbortSignal.timeout(this.timeoutMs);
    const running = this.lookup(route, 'hints', epoch, signal)
      .then((found) => {
        if (!signal.aborted && !this.closed) this.rememberRelays(route, epoch, found);
      })
      .finally(() => this.relayLookups.delete(route.deviceId));
    this.relayLookups.set(route.deviceId, running);
    return running;
  }

  /** The records of `purpose` the peer published for this device, opened; empty when none. */
  private async lookup(
    peer: IMeshPeerRoute,
    purpose: 'hints' | 'revocation',
    epoch: number,
    signal: AbortSignal,
  ): Promise<{ readonly epoch: number; readonly data: Uint8Array }[]> {
    const reads = [epoch - 1, epoch, epoch + 1].flatMap((e) =>
      this.options.stores.map(async (store) => {
        const data = await this.read(store, peer, purpose, e, 0, signal);
        return data === undefined ? undefined : { epoch: e, data };
      }),
    );
    return (await Promise.all(reads)).filter((r) => r !== undefined);
  }

  /** One chunk of the peer's record, opened; `undefined` when it is not there or not the peer's. */
  private async read(
    store: IRendezvousItemStore,
    peer: IMeshPeerRoute,
    purpose: 'hints' | 'revocation',
    epoch: number,
    chunk: number,
    signal: AbortSignal,
  ): Promise<Uint8Array | undefined> {
    try {
      const address = await itemAddress(peer.rendezvous, purpose, 'inbound', epoch, chunk);
      const value = await store.get(address.key.publicKey, address.salt, signal);
      if (value === undefined) return undefined;
      // Sealed for exactly this pair, direction, purpose and epoch, or it is not the peer's.
      const opened = await peer.rendezvous.openRecord(value, epoch, purpose);
      return opened?.epoch === epoch ? opened.hints : undefined;
    } catch {
      // allow-fallback: a record that cannot be read is not there; the other stores and epochs count
      return undefined;
    }
  }

  /** The device lists the peer published for this device, whole; one per store and epoch found. */
  private async lookupLists(
    peer: IMeshPeerRoute,
    epoch: number,
    signal: AbortSignal,
  ): Promise<unknown[]> {
    const reads = [epoch - 1, epoch, epoch + 1].flatMap((e) =>
      this.options.stores.map(async (store) => {
        const first = await this.read(store, peer, 'revocation', e, 0, signal);
        const count = first === undefined ? undefined : chunkCount(first);
        if (first === undefined || count === undefined) return undefined;
        const rest = await Promise.all(
          Array.from({ length: count - 1 }, (_, i) =>
            this.read(store, peer, 'revocation', e, i + 1, signal),
          ),
        );
        if (rest.some((chunk) => chunk === undefined)) return undefined;
        return joinChunks([first, ...(rest as Uint8Array[])]);
      }),
    );
    return (await Promise.all(reads)).filter((value) => value !== undefined);
  }

  /**
   * Publish this device's records for `routes`, each pair after its own random delay. A pair already
   * waiting to publish for this epoch and port keeps its delay.
   */
  public advertise(routes: readonly IMeshPeerRoute[], port: number): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.routes = routes;
    const epoch = rendezvousEpoch(this.now());
    const wanted = new Set(routes.map((r) => r.outbound));
    for (const [topic, scheduled] of this.scheduled) {
      if (!wanted.has(topic)) {
        clearTimeout(scheduled.timer);
        this.scheduled.delete(topic);
      }
    }
    if (this.prefetchedEpoch !== epoch) {
      // The freshness lookup has only seconds; what the peers published is read ahead of it.
      this.prefetchedEpoch = epoch;
      void this.findLists(AbortSignal.timeout(PREFETCH_TIMEOUT_MS));
    }
    const maxJitter = this.options.maxPublishJitterMs ?? DEFAULT_MAX_PUBLISH_JITTER_MS;
    for (const route of routes) {
      const held = this.scheduled.get(route.outbound);
      if (held !== undefined && held.epoch === epoch && held.port === port) continue;
      if (held !== undefined) clearTimeout(held.timer);
      const timer = setTimeout(
        () => {
          this.scheduled.delete(route.outbound);
          void this.publish(route, port);
        },
        publishJitter(maxJitter, this.options.random),
      );
      timer.unref?.();
      this.scheduled.set(route.outbound, { timer, epoch, port });
    }
    return Promise.resolve();
  }

  private async publish(route: IMeshPeerRoute, port: number): Promise<void> {
    if (this.closed) return;
    const now = this.now();
    const epoch = rendezvousEpoch(now);
    const records: { purpose: 'hints' | 'revocation'; chunk: number; plaintext: Uint8Array }[] = [];
    try {
      records.push({
        purpose: 'hints',
        chunk: 0,
        plaintext: encodeHints(
          this.options.addresses().map((host) => ({ host, port })),
          this.options.relayEndpoints?.() ?? [],
        ),
      });
      const lists = this.options.lists?.();
      if (lists !== undefined) {
        const chunks = await chunkJson({
          r: lists.revocation,
          ...(lists.signingKeyRevocation !== undefined ? { s: lists.signingKeyRevocation } : {}),
        });
        for (const [chunk, plaintext] of chunks.entries()) {
          records.push({ purpose: 'revocation', chunk, plaintext });
        }
      }
    } catch (error) {
      this.options.onError?.(asError(error));
    }
    for (const { purpose, chunk, plaintext } of records) {
      try {
        const sealed = await route.rendezvous.sealRecord(plaintext, epoch, purpose);
        const address = await itemAddress(route.rendezvous, purpose, 'outbound', epoch, chunk);
        const results = await Promise.allSettled(
          this.options.stores.map((store) => store.put(address, sealed, now)),
        );
        for (const result of results) {
          if (result.status === 'rejected') this.options.onError?.(asError(result.reason));
        }
      } catch (error) {
        this.options.onError?.(asError(error));
      }
    }
  }

  /**
   * The lists the peers published for this device, as received — candidates for the freshness
   * lookup before a remote admission, each verified there. Any paired device can publish anything
   * here, so candidates are returned rather than the one that claims to be newest, and each peer's
   * newest few come before any peer's next, so one peer's records cannot crowd out another's. When
   * `signal` ends first, what the last finished lookup found. `undefined`: none.
   */
  public async latestLists(signal: AbortSignal): Promise<IFetchedLists | undefined> {
    const ended = new Promise<undefined>((resolve) => {
      if (signal.aborted) resolve(undefined);
      signal.addEventListener('abort', () => resolve(undefined), { once: true });
    });
    const found = await Promise.race([this.findLists(signal), ended]);
    return found ?? this.listsFound;
  }

  private async findLists(signal: AbortSignal): Promise<IFetchedLists | undefined> {
    const epoch = rendezvousEpoch(this.now());
    const found = await Promise.all(
      this.routes.slice(0, MAX_LIST_PEERS).map((route) => this.lookupLists(route, epoch, signal)),
    );
    const revocation: unknown[][] = [];
    const signingKeyRevocation: unknown[][] = [];
    for (const values of found) {
      const r: unknown[] = [];
      const s: unknown[] = [];
      for (const value of values) {
        if (typeof value !== 'object' || value === null) continue;
        const lists = value as { r?: unknown; s?: unknown };
        if (lists.r !== undefined) r.push(lists.r);
        if (lists.s !== undefined) s.push(lists.s);
      }
      revocation.push(r);
      signingKeyRevocation.push(s);
    }
    const r = fairlyNewestFirst(revocation);
    const s = fairlyNewestFirst(signingKeyRevocation);
    const lists: IFetchedLists | undefined =
      r.length === 0 && s.length === 0
        ? undefined
        : {
            ...(r.length > 0 ? { revocation: r } : {}),
            ...(s.length > 0 ? { signingKeyRevocation: s } : {}),
          };
    if (!signal.aborted) this.listsFound = lists;
    return lists;
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const { timer } of this.scheduled.values()) clearTimeout(timer);
    this.scheduled.clear();
    for (const store of this.options.stores) store.close();
  }
}

/** Candidates without repeats, in order. */
function distinct(candidates: readonly unknown[]): unknown[] {
  const seen = new Set<string>();
  return candidates.filter((c) => {
    const key = JSON.stringify(c);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Distinct candidates, the one claiming the highest `seq` first. */
function newestFirst(candidates: readonly unknown[]): unknown[] {
  return distinct(candidates).sort((a, b) => seqOf(b) - seqOf(a));
}

/**
 * Distinct candidates from every peer, bounded: a few per peer, and every peer's newest before any
 * peer's next, so the bound never cuts one peer's newest for another's many.
 */
function fairlyNewestFirst(byPeer: readonly (readonly unknown[])[]): unknown[] {
  const ranked = byPeer.map((candidates) =>
    newestFirst(candidates).slice(0, MAX_LIST_CANDIDATES_PER_PEER),
  );
  const rounds: unknown[] = [];
  for (let rank = 0; rank < MAX_LIST_CANDIDATES_PER_PEER; rank += 1) {
    rounds.push(...newestFirst(ranked.flatMap((candidates) => candidates.slice(rank, rank + 1))));
  }
  return distinct(rounds).slice(0, MAX_LIST_CANDIDATES);
}

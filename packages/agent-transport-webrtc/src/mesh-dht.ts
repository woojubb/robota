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
  LISTS_PADDED_BYTES,
  decodeHints,
  encodeHints,
  itemAddress,
  padJson,
  publishJitter,
  unpadJson,
} from './mesh-records.js';

import type { IMeshCandidate, IMeshCandidateSource, IMeshPeerRoute } from './mesh-discovery.js';
import type { IRendezvousItemStore } from './mesh-item-store.js';

/** Longest delay before a pair's records are published, by default. */
export const DEFAULT_MAX_PUBLISH_JITTER_MS = 90_000;
/** How long a DHT lookup may take, by default: iterative lookups take seconds. */
const DEFAULT_LOOKUP_TIMEOUT_MS = 6_000;
/** Peers whose list records a freshness lookup reads. */
const MAX_LIST_PEERS = 16;

/** The device lists this device hands on to its peers. */
export interface IPublishedLists {
  readonly revocation: IDeviceRevocationList;
  readonly signingKeyRevocation?: ISigningKeyRevocation;
}

/** What a freshness lookup found, as received: each part is verified before use. */
export interface IFetchedLists {
  readonly revocation?: unknown;
  readonly signingKeyRevocation?: unknown;
}

export interface IMeshDhtOptions {
  /** Where records go and come from; every one is written to and read from. */
  readonly stores: readonly IRendezvousItemStore[];
  /** This device's addresses to publish with its endpoint port. */
  readonly addresses: () => readonly string[];
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

  /** The records of `purpose` the peer published for this device, opened; empty when none. */
  private async lookup(
    peer: IMeshPeerRoute,
    purpose: 'hints' | 'revocation',
    epoch: number,
    signal: AbortSignal,
  ): Promise<{ readonly epoch: number; readonly data: Uint8Array }[]> {
    const reads = [epoch - 1, epoch, epoch + 1].flatMap((e) =>
      this.options.stores.map(async (store) => {
        try {
          const address = await itemAddress(peer.rendezvous, purpose, 'inbound', e);
          const value = await store.get(address.key.publicKey, address.salt, signal);
          if (value === undefined) return undefined;
          // Sealed for exactly this pair, direction, purpose and epoch, or it is not the peer's.
          const opened = await peer.rendezvous.openRecord(value, e, purpose);
          return opened?.epoch === e ? { epoch: e, data: opened.hints } : undefined;
        } catch {
          // allow-fallback: a record that cannot be read is not there; the other stores and epochs count
          return undefined;
        }
      }),
    );
    return (await Promise.all(reads)).filter((r) => r !== undefined);
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
    const records: { purpose: 'hints' | 'revocation'; plaintext: Uint8Array }[] = [];
    try {
      records.push({
        purpose: 'hints',
        plaintext: encodeHints(this.options.addresses().map((host) => ({ host, port }))),
      });
      const lists = this.options.lists?.();
      if (lists !== undefined)
        records.push({ purpose: 'revocation', plaintext: listsPlaintext(lists) });
    } catch (error) {
      this.options.onError?.(asError(error));
    }
    for (const { purpose, plaintext } of records) {
      try {
        const sealed = await route.rendezvous.sealRecord(plaintext, epoch, purpose);
        const address = await itemAddress(route.rendezvous, purpose, 'outbound', epoch);
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
   * The newest lists any peer published for this device, as received — for the freshness lookup
   * before a remote admission. `undefined` when no peer published any.
   */
  public async latestLists(signal: AbortSignal): Promise<IFetchedLists | undefined> {
    const epoch = rendezvousEpoch(this.now());
    const found = await Promise.all(
      this.routes
        .slice(0, MAX_LIST_PEERS)
        .map((route) => this.lookup(route, 'revocation', epoch, signal)),
    );
    let revocation: unknown;
    let signingKeyRevocation: unknown;
    for (const record of found.flat()) {
      const value = unpadJson(record.data);
      if (typeof value !== 'object' || value === null) continue;
      const r = value as { r?: unknown; s?: unknown };
      if (seqOf(r.r) > seqOf(revocation)) revocation = r.r;
      if (seqOf(r.s) > seqOf(signingKeyRevocation)) signingKeyRevocation = r.s;
    }
    if (revocation === undefined && signingKeyRevocation === undefined) return undefined;
    return {
      ...(revocation !== undefined ? { revocation } : {}),
      ...(signingKeyRevocation !== undefined ? { signingKeyRevocation } : {}),
    };
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const { timer } of this.scheduled.values()) clearTimeout(timer);
    this.scheduled.clear();
    for (const store of this.options.stores) store.close();
  }
}

/**
 * The lists as one fixed-size plaintext. A signing-key revocation that does not fit alongside the
 * device revocation list is left out; a device revocation list that does not fit alone is an error.
 */
function listsPlaintext(lists: IPublishedLists): Uint8Array {
  if (lists.signingKeyRevocation !== undefined) {
    try {
      return padJson({ r: lists.revocation, s: lists.signingKeyRevocation }, LISTS_PADDED_BYTES);
    } catch {
      // allow-fallback: too large together; the device revocation list alone is still worth handing on
    }
  }
  return padJson({ r: lists.revocation }, LISTS_PADDED_BYTES);
}

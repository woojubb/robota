/**
 * Live signaling between two devices over public Nostr relays, as ephemeral events (kinds
 * 20000–29999, which relays forward and do not store).
 *
 * Nostr is only a mailbox run by strangers, so nothing in an event tells them whose it is:
 * - the author key is a one-time key of the pair, the direction and the epoch;
 * - the kind is drawn from the ephemeral range per pair, direction and epoch, so no constant kind
 *   marks the product;
 * - there are no tags, and the content is the pair's own AEAD ciphertext of the signal, padded to a
 *   step so its length says little about what it carries.
 *
 * Events go to several relays of different operators. What arrives is checked (shape, signature,
 * author key and kind for that pair and epoch, age, duplicates) and opened before it reaches the
 * node, which decodes it as hostile input like any relay-delivered signal and admits a peer by the
 * device handshake alone. The draft WebRTC-signaling NIP is not used: the event format here is ours.
 */
import { rendezvousEpoch, RENDEZVOUS_EPOCH_MS } from '@robota-sdk/agent-remote-pairing';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, getPublicKey, verifyEvent, type Event } from 'nostr-tools/pure';

import { padJson, unpadJson } from './mesh-records.js';

import type { IMeshPeerRoute } from './mesh-discovery.js';
import type { IMeshRelay } from './mesh-relay.js';

/** A Nostr event as relays carry it. */
export interface INostrEvent {
  readonly id: string;
  readonly pubkey: string;
  readonly created_at: number;
  readonly kind: number;
  readonly tags: readonly (readonly string[])[];
  readonly content: string;
  readonly sig: string;
}

export interface INostrFilter {
  readonly kinds: readonly number[];
  readonly authors: readonly string[];
  readonly since?: number;
}

/** The relays a device signals through. */
export interface INostrRelayPool {
  /** Send `event` to every relay; resolves `true` when at least one took it. Never rejects. */
  publish(event: INostrEvent): Promise<boolean>;
  /** Events matching `filter` from any relay, as received. */
  subscribe(filter: INostrFilter, onEvent: (event: unknown) => void): { close(): void };
  close(): void;
}

const EPHEMERAL_KIND_BASE = 20_000;
const EPHEMERAL_KIND_SPAN = 10_000;
/** Plaintext is padded up to a multiple of this. */
export const NOSTR_SIGNAL_PAD_STEP = 512;
/** Largest signal plaintext sent; relays refuse large events. */
const MAX_SIGNAL_BYTES = 32 * 1024;
/** Largest event content accepted. */
const MAX_CONTENT_CHARS = 48 * 1024;
/** An event older or newer than this is not taken: a relay could replay it. */
const DEFAULT_MAX_EVENT_AGE_S = 120;
/** Event ids remembered to drop the copies several relays deliver. */
const SEEN_IDS = 2048;
const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;

/** The ephemeral kind of `tag`: a pair's kind for one direction and epoch. */
export function ephemeralKindOf(tag: Uint8Array): number {
  return EPHEMERAL_KIND_BASE + ((((tag[0] ?? 0) << 8) | (tag[1] ?? 0)) % EPHEMERAL_KIND_SPAN);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array | undefined {
  try {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return undefined;
  }
}

/** An event's fields, copied out of whatever arrived, or `undefined` when it is not an event. */
function readEvent(value: unknown): Event | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const r = value as Record<string, unknown>;
  if (typeof r.id !== 'string' || !HEX64.test(r.id)) return undefined;
  if (typeof r.pubkey !== 'string' || !HEX64.test(r.pubkey)) return undefined;
  if (typeof r.sig !== 'string' || !HEX128.test(r.sig)) return undefined;
  if (typeof r.kind !== 'number' || !Number.isInteger(r.kind)) return undefined;
  if (typeof r.created_at !== 'number' || !Number.isInteger(r.created_at)) return undefined;
  if (typeof r.content !== 'string' || r.content.length > MAX_CONTENT_CHARS) return undefined;
  if (!Array.isArray(r.tags) || r.tags.length !== 0) return undefined;
  // A fresh object: nothing the sender attached (such as a cached verdict) comes along.
  return {
    id: r.id,
    pubkey: r.pubkey,
    sig: r.sig,
    kind: r.kind,
    created_at: r.created_at,
    content: r.content,
    tags: [],
  };
}

interface IOutbound {
  readonly route: IMeshPeerRoute;
  readonly epoch: number;
  readonly secretKey: Uint8Array;
  readonly kind: number;
}

interface IInbound {
  readonly route: IMeshPeerRoute;
  readonly epoch: number;
  readonly kind: number;
}

export interface INostrMeshRelayOptions {
  readonly pool: INostrRelayPool;
  readonly maxEventAgeS?: number;
  readonly now?: () => number;
  readonly onError?: (error: Error) => void;
}

/**
 * A mesh relay over Nostr. It needs the peers (see {@link IMeshRelay.declarePeers}) to derive their
 * keys, and addresses a pair by its outbound topic. It reports a topic absent only when it knows no
 * pair by it: whether the peer is listening, a relay that forwards ephemeral events cannot tell.
 */
export class NostrMeshRelay implements IMeshRelay {
  private readonly messages = new Set<(topic: string, data: unknown) => void>();
  private readonly absents = new Set<(topic: string) => void>();
  private outbound = new Map<string, IOutbound>();
  private inbound = new Map<string, IInbound>();
  private subscription?: { close(): void };
  private chain: Promise<void> = Promise.resolve();
  private readonly seen = new Set<string>();
  private routes: readonly IMeshPeerRoute[] = [];
  private epoch?: number;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;

  public constructor(private readonly options: INostrMeshRelayOptions) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private report(error: unknown): void {
    this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
  }

  /** Run `task` after everything queued before it, so keys are in place before a send uses them. */
  private enqueue(task: () => Promise<void> | void): void {
    this.chain = this.chain.then(task).catch((error: unknown) => this.report(error));
  }

  /** Resolves once every declaration, send and receipt queued so far has run. */
  public whenIdle(): Promise<void> {
    return this.chain;
  }

  public declarePresence(): void {
    // Nostr addresses a pair by its derived keys, not by the relay inbox topics.
  }

  public declarePeers(peers: readonly IMeshPeerRoute[]): void {
    this.enqueue(() => this.derive(peers));
  }

  /** The pairs' keys and kinds for this epoch, and a subscription for the peers' adjacent epochs. */
  private async derive(peers: readonly IMeshPeerRoute[]): Promise<void> {
    if (this.closed) return;
    this.routes = peers;
    const epoch = rendezvousEpoch(this.now());
    const outbound = new Map<string, IOutbound>();
    const inbound = new Map<string, IInbound>();
    for (const route of peers) {
      const secretKey = await route.rendezvous.signingSeed('outbound', epoch, 'signal');
      const kind = ephemeralKindOf(await route.rendezvous.tag('nostr-kind', 'outbound', epoch));
      outbound.set(route.outbound, { route, epoch, secretKey, kind });
      for (const e of [epoch - 1, epoch, epoch + 1]) {
        const seed = await route.rendezvous.signingSeed('inbound', e, 'signal');
        const peerKind = ephemeralKindOf(await route.rendezvous.tag('nostr-kind', 'inbound', e));
        inbound.set(getPublicKey(seed), { route, epoch: e, kind: peerKind });
      }
    }
    if (this.closed) return;
    this.outbound = outbound;
    this.inbound = inbound;
    this.epoch = epoch;
    this.subscription?.close();
    this.subscription =
      inbound.size === 0
        ? undefined
        : this.options.pool.subscribe(
            {
              kinds: [...new Set([...inbound.values()].map((i) => i.kind))],
              authors: [...inbound.keys()],
              since:
                Math.floor(this.now() / 1000) -
                (this.options.maxEventAgeS ?? DEFAULT_MAX_EVENT_AGE_S),
            },
            (event) => this.enqueue(() => this.receive(event)),
          );
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(
      () => this.declarePeers(this.routes),
      Math.max(0, (epoch + 1) * RENDEZVOUS_EPOCH_MS - this.now()),
    );
    this.timer.unref?.();
  }

  public send(topic: string, data: unknown): void {
    if (this.closed) return;
    this.enqueue(async () => {
      if (this.closed) return;
      // A send that outlived its epoch waits for the new keys.
      if (this.epoch !== undefined && rendezvousEpoch(this.now()) !== this.epoch) {
        await this.derive(this.routes);
      }
      const out = this.outbound.get(topic);
      if (out === undefined) {
        for (const handler of this.absents) handler(topic);
        return;
      }
      const json = new TextEncoder().encode(JSON.stringify(data)).length;
      if (json > MAX_SIGNAL_BYTES) throw new Error('signal too large for a Nostr event');
      const padded = padJson(data, Math.ceil(json / NOSTR_SIGNAL_PAD_STEP) * NOSTR_SIGNAL_PAD_STEP);
      const sealed = await out.route.rendezvous.sealRecord(padded, out.epoch, 'signal');
      const event = finalizeEvent(
        {
          kind: out.kind,
          created_at: Math.floor(this.now() / 1000),
          tags: [],
          content: toBase64(sealed),
        },
        out.secretKey,
      );
      if (!(await this.options.pool.publish(event))) {
        throw new Error('no Nostr relay took the signal');
      }
    });
  }

  private async receive(raw: unknown): Promise<void> {
    if (this.closed) return;
    const event = readEvent(raw);
    if (event === undefined || this.seen.has(event.id)) return;
    const from = this.inbound.get(event.pubkey);
    if (from === undefined || event.kind !== from.kind) return;
    const ageS = Math.abs(Math.floor(this.now() / 1000) - event.created_at);
    if (ageS > (this.options.maxEventAgeS ?? DEFAULT_MAX_EVENT_AGE_S)) return;
    if (!verifyEvent(event)) return;
    this.remember(event.id);
    const sealed = fromBase64(event.content);
    if (sealed === undefined) return;
    const opened = await from.route.rendezvous.openRecord(sealed, from.epoch, 'signal');
    if (opened?.epoch !== from.epoch) return;
    const data = unpadJson(opened.hints);
    if (data === undefined || this.closed) return;
    for (const handler of this.messages) handler(from.route.inbound, data);
  }

  private remember(id: string): void {
    this.seen.add(id);
    if (this.seen.size <= SEEN_IDS) return;
    const oldest = this.seen.values().next().value;
    if (oldest !== undefined) this.seen.delete(oldest);
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
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.subscription?.close();
    this.messages.clear();
    this.absents.clear();
    this.options.pool.close();
  }
}

// ── In-process relays, for tests and loopback ──────────────────────────────────────────────────

export interface IInMemoryNostrHub {
  /** A client of every relay of this hub. */
  pool(): INostrRelayPool;
  /** Every event the hub forwarded, as received. */
  readonly events: readonly INostrEvent[];
  /** Deliver `event` as a relay would, to every matching subscription (a hostile relay's injection). */
  inject(event: unknown): void;
}

function matches(filter: INostrFilter, event: INostrEvent): boolean {
  return filter.kinds.includes(event.kind) && filter.authors.includes(event.pubkey);
}

/**
 * In-process relays with a relay's rules for ephemeral events: an event whose signature does not
 * verify is refused, and one that passes is forwarded to matching subscriptions and not stored.
 * Deliveries run on a microtask, as a network would never deliver synchronously.
 */
export function createInMemoryNostrHub(): IInMemoryNostrHub {
  const subscriptions = new Set<{ filter: INostrFilter; onEvent: (event: unknown) => void }>();
  const events: INostrEvent[] = [];
  const deliver = (event: unknown): void => {
    const copy: unknown = JSON.parse(JSON.stringify(event));
    queueMicrotask(() => {
      for (const sub of [...subscriptions]) {
        if (matches(sub.filter, copy as INostrEvent)) sub.onEvent(copy);
      }
    });
  };
  return {
    pool: () => {
      const mine = new Set<{ filter: INostrFilter; onEvent: (event: unknown) => void }>();
      return {
        publish: (event) => {
          const read = readEvent(event);
          if (read === undefined || !verifyEvent(read)) return Promise.resolve(false);
          events.push(JSON.parse(JSON.stringify(event)) as INostrEvent);
          deliver(event);
          return Promise.resolve(true);
        },
        subscribe: (filter, onEvent) => {
          const sub = { filter, onEvent };
          subscriptions.add(sub);
          mine.add(sub);
          return {
            close: () => {
              subscriptions.delete(sub);
              mine.delete(sub);
            },
          };
        },
        close: () => {
          for (const sub of mine) subscriptions.delete(sub);
          mine.clear();
        },
      };
    },
    events,
    inject: (event) => deliver(event),
  };
}

// ── Public relays, through nostr-tools ─────────────────────────────────────────────────────────

/**
 * A pool over `relays` (`wss://…`, several operators) with `nostr-tools`, connecting on first use.
 * The relays see one-time keys, rotating kinds and ciphertext; they are trusted with nothing.
 */
export function createNostrRelayPool(relays: readonly string[]): INostrRelayPool {
  if (relays.length === 0) throw new Error('a Nostr relay pool needs at least one relay');
  const pool = new SimplePool();
  const urls = [...relays];
  return {
    publish: async (event) => {
      const results = await Promise.allSettled(pool.publish(urls, event as Event));
      return results.some((r) => r.status === 'fulfilled');
    },
    subscribe: (filter, onEvent) =>
      pool.subscribeMany(
        urls,
        {
          kinds: [...filter.kinds],
          authors: [...filter.authors],
          ...(filter.since !== undefined ? { since: filter.since } : {}),
        },
        { onevent: (event) => onEvent(event) },
      ),
    close: () => pool.destroy(),
  };
}

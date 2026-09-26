/**
 * Finding peer devices on the local network with multicast DNS service discovery (RFC 6762/6763),
 * without telling the network whose devices they are or how many.
 *
 * - The service type is generic and names no product.
 * - Every instance name is a pairwise tag for `dir(self → peer)` in the current epoch, so only that
 *   peer recognises it, and it changes every epoch. The host name the records point at is random per
 *   epoch rather than the machine's name.
 * - The instance count is padded with random tags to a fixed step, so the answer does not reveal
 *   how many devices this one pairs with.
 *
 * A lookup asks for the service, keeps the instances whose name is one of the peer's tags for the
 * adjacent epochs, and yields the answering address with the advertised port. That is a candidate
 * only: an attacker on the network can answer too, and gains nothing, because the peer is admitted
 * by the device handshake or not at all.
 */
import { createRequire } from 'node:module';
import { networkInterfaces } from 'node:os';

import { rendezvousEpoch, RENDEZVOUS_EPOCH_MS } from '@robota-sdk/agent-remote-pairing';

import type { IMeshCandidate, IMeshCandidateSource, IMeshPeerRoute } from './mesh-discovery.js';

/** The DNS-SD service type. Generic on purpose: it must not name the product. */
export const MESH_MDNS_SERVICE = '_rdv._tcp.local';
/** Instance counts are padded up to a multiple of this. */
export const MESH_MDNS_PAD_STEP = 8;
/** Bytes of a pairwise tag used as an instance name (hex-encoded). */
const INSTANCE_TAG_BYTES = 16;
const RECORD_TTL_S = 120;
const DEFAULT_LOOKUP_TIMEOUT_MS = 1_000;

/** A DNS resource record, in the shape `multicast-dns` reads and writes. */
export interface IMdnsRecord {
  readonly name: string;
  readonly type: string;
  readonly ttl?: number;
  readonly data?: unknown;
}

export interface IMdnsQuestion {
  readonly name: string;
  readonly type: string;
}

export interface IMdnsPacket {
  readonly questions?: readonly IMdnsQuestion[];
  readonly answers?: readonly IMdnsRecord[];
  readonly additionals?: readonly IMdnsRecord[];
}

export interface IMdnsRemote {
  readonly address: string;
}

/** The slice of a `multicast-dns` instance this module drives. */
export interface IMdnsTransport {
  on(
    event: 'query' | 'response',
    listener: (packet: IMdnsPacket, rinfo: IMdnsRemote) => void,
  ): void;
  on(event: 'error' | 'warning', listener: (error: Error) => void): void;
  removeListener(
    event: 'response',
    listener: (packet: IMdnsPacket, rinfo: IMdnsRemote) => void,
  ): void;
  query(packet: { readonly questions: readonly IMdnsQuestion[] }): void;
  respond(packet: {
    readonly answers: readonly IMdnsRecord[];
    readonly additionals?: readonly IMdnsRecord[];
  }): void;
  destroy(): void;
}

export interface IMeshMdnsOptions {
  /** Default: a `multicast-dns` socket on the standard group and port. */
  readonly createTransport?: () => IMdnsTransport;
  /** This device's addresses for the A/AAAA records. Default: its non-internal interfaces. */
  readonly addresses?: () => readonly string[];
  readonly lookupTimeoutMs?: number;
  /** mDNS cannot run (e.g. the port is unavailable): the other candidate sources still do. */
  readonly onError?: (error: Error) => void;
  readonly now?: () => number;
}

function defaultTransport(): IMdnsTransport {
  const requireFrom = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- resolved only when mDNS is used, so importing the package opens no socket
  const create = requireFrom('multicast-dns') as () => IMdnsTransport;
  return create();
}

function localAddresses(): string[] {
  const out: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      if (
        entry.family === 'IPv4' ||
        (entry.family === 'IPv6' && !entry.address.startsWith('fe80'))
      ) {
        out.push(entry.address);
      }
    }
  }
  return out;
}

function randomHex(bytes: number): string {
  const out = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(out);
  return Buffer.from(out).toString('hex');
}

function instanceLabel(tag: Uint8Array): string {
  return Buffer.from(tag.subarray(0, INSTANCE_TAG_BYTES)).toString('hex');
}

/** How many instances `count` real ones are announced as. */
export function paddedInstanceCount(count: number): number {
  return Math.max(MESH_MDNS_PAD_STEP, Math.ceil(count / MESH_MDNS_PAD_STEP) * MESH_MDNS_PAD_STEP);
}

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export class MeshMdns implements IMeshCandidateSource {
  private transport?: IMdnsTransport;
  private routes: readonly IMeshPeerRoute[] = [];
  private port?: number;
  private records?: { readonly answers: IMdnsRecord[]; readonly additionals: IMdnsRecord[] };
  private instances = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private closed = false;

  public constructor(private readonly options: IMeshMdnsOptions = {}) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  /** The transport, created on first use. `undefined` once it failed or the source is closed. */
  private open(): IMdnsTransport | undefined {
    if (this.closed) return undefined;
    if (this.transport !== undefined) return this.transport;
    try {
      const transport = (this.options.createTransport ?? defaultTransport)();
      transport.on('query', (packet: IMdnsPacket) => this.onQuery(packet));
      transport.on('error', (error: Error) => this.options.onError?.(error));
      this.transport = transport;
      return transport;
    } catch (error) {
      this.closed = true;
      this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
      return undefined;
    }
  }

  /** Announce this device to `routes`' peers, as a signaling endpoint on `port`. */
  public advertise(routes: readonly IMeshPeerRoute[], port: number): Promise<void> {
    this.routes = routes;
    this.port = port;
    return this.rebuild();
  }

  private async rebuild(): Promise<void> {
    const generation = ++this.generation;
    const port = this.port;
    if (this.closed || port === undefined) return;
    const epoch = rendezvousEpoch(this.now());
    const tags = await Promise.all(
      this.routes.map((route) => route.rendezvous.tag('mdns', 'outbound', epoch)),
    );
    if (generation !== this.generation || this.closed) return;
    const labels = tags.map(instanceLabel);
    while (labels.length < paddedInstanceCount(tags.length)) {
      labels.push(randomHex(INSTANCE_TAG_BYTES));
    }
    labels.sort();
    const target = `${randomHex(8)}.local`;
    const answers: IMdnsRecord[] = labels.map((label) => ({
      name: MESH_MDNS_SERVICE,
      type: 'PTR',
      ttl: RECORD_TTL_S,
      data: `${label}.${MESH_MDNS_SERVICE}`,
    }));
    const additionals: IMdnsRecord[] = [];
    for (const label of labels) {
      const name = `${label}.${MESH_MDNS_SERVICE}`;
      additionals.push(
        { name, type: 'SRV', ttl: RECORD_TTL_S, data: { priority: 0, weight: 0, port, target } },
        { name, type: 'TXT', ttl: RECORD_TTL_S, data: [] },
      );
    }
    for (const address of (this.options.addresses ?? localAddresses)()) {
      additionals.push({
        name: target,
        type: address.includes(':') ? 'AAAA' : 'A',
        ttl: RECORD_TTL_S,
        data: address,
      });
    }
    this.records = { answers, additionals };
    this.instances = new Set(labels.map((label) => `${label}.${MESH_MDNS_SERVICE}`.toLowerCase()));
    this.schedule(epoch);
    // An unsolicited announcement, so peers already browsing hear of the new names at once.
    this.open()?.respond(this.records);
  }

  private schedule(epoch: number): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    const delay = Math.max(0, (epoch + 1) * RENDEZVOUS_EPOCH_MS - this.now());
    this.timer = setTimeout(() => {
      // allow-fallback: a failed rebuild keeps the last epoch's names; lookups try adjacent epochs
      this.rebuild().catch(() => undefined);
    }, delay);
    this.timer.unref?.();
  }

  private onQuery(packet: IMdnsPacket): void {
    const records = this.records;
    if (records === undefined || this.closed) return;
    const asked = (packet.questions ?? []).some(
      (q) =>
        (sameName(q.name, MESH_MDNS_SERVICE) && (q.type === 'PTR' || q.type === 'ANY')) ||
        this.instances.has(q.name.toLowerCase()),
    );
    if (asked) this.transport?.respond(records);
  }

  public async candidates(
    peer: IMeshPeerRoute,
    signal: AbortSignal,
  ): Promise<readonly IMeshCandidate[]> {
    const transport = this.open();
    if (transport === undefined || signal.aborted) return [];
    const epoch = rendezvousEpoch(this.now());
    const wanted = new Set(
      (await peer.rendezvous.lookupTags('mdns', epoch)).map(
        (tag) => `${instanceLabel(tag)}.${MESH_MDNS_SERVICE}`,
      ),
    );
    if (signal.aborted || this.closed) return [];
    return new Promise<readonly IMeshCandidate[]>((resolve) => {
      const found: IMeshCandidate[] = [];
      const finish = (): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', finish);
        transport.removeListener('response', onResponse);
        resolve(found);
      };
      const onResponse = (packet: IMdnsPacket, rinfo: IMdnsRemote): void => {
        const records = [...(packet.answers ?? []), ...(packet.additionals ?? [])];
        for (const ptr of records) {
          if (ptr.type !== 'PTR' || !sameName(ptr.name, MESH_MDNS_SERVICE)) continue;
          if (typeof ptr.data !== 'string' || !wanted.has(ptr.data.toLowerCase())) continue;
          const srv = records.find((r) => r.type === 'SRV' && sameName(r.name, ptr.data as string));
          const port = (srv?.data as { port?: unknown } | undefined)?.port;
          if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0 || port > 65_535) {
            continue;
          }
          // The address the answer came from: the peer's own records could name any address.
          if (!found.some((c) => c.host === rinfo.address && c.port === port)) {
            found.push({ host: rinfo.address, port });
          }
        }
        if (found.length > 0) finish();
      };
      const timer = setTimeout(finish, this.options.lookupTimeoutMs ?? DEFAULT_LOOKUP_TIMEOUT_MS);
      timer.unref?.();
      signal.addEventListener('abort', finish, { once: true });
      transport.on('response', onResponse);
      transport.query({ questions: [{ name: MESH_MDNS_SERVICE, type: 'PTR' }] });
    });
  }

  public close(): void {
    this.closed = true;
    this.generation += 1;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.transport?.destroy();
    this.transport = undefined;
  }
}

export interface IInMemoryMdnsBus {
  /** A transport on this bus whose answers come from `address`. */
  transport(address: string): IMdnsTransport;
  /** Every packet answered on the bus, in order. */
  readonly responses: readonly IMdnsPacket[];
}

/**
 * An in-process multicast group — for tests and loopback only. A query reaches every member,
 * itself included, as multicast loops back; an answer reaches every member with the answering
 * member's address. Packets cross as JSON and are delivered on a microtask, as a network would.
 */
export function createInMemoryMdnsBus(): IInMemoryMdnsBus {
  type TListener = (packet: IMdnsPacket, rinfo: IMdnsRemote) => void;
  interface IMember {
    readonly address: string;
    readonly queries: Set<TListener>;
    readonly responses: Set<TListener>;
  }
  const members = new Set<IMember>();
  const responses: IMdnsPacket[] = [];
  const broadcast = (
    from: IMember,
    packet: IMdnsPacket,
    pick: (member: IMember) => Set<TListener>,
  ): void => {
    const copy = JSON.parse(JSON.stringify(packet)) as IMdnsPacket;
    queueMicrotask(() => {
      for (const member of members) {
        for (const listener of pick(member)) listener(copy, { address: from.address });
      }
    });
  };
  return {
    responses,
    transport(address) {
      const self: IMember = { address, queries: new Set(), responses: new Set() };
      members.add(self);
      return {
        on(event: string, listener: TListener) {
          if (event === 'query') self.queries.add(listener);
          if (event === 'response') self.responses.add(listener);
        },
        removeListener(_event, listener) {
          self.responses.delete(listener);
        },
        query(packet) {
          broadcast(self, packet, (m) => m.queries);
        },
        respond(packet) {
          responses.push(JSON.parse(JSON.stringify(packet)) as IMdnsPacket);
          broadcast(self, packet, (m) => m.responses);
        },
        destroy() {
          members.delete(self);
        },
      } as IMdnsTransport;
    },
  };
}

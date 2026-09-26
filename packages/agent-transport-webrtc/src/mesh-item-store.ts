/**
 * Where rendezvous records are published: a store of signed mutable items that anyone may run and
 * nobody is trusted to run honestly.
 *
 * A store checks every item it returns against the key and salt it was asked for, so a node or relay
 * that serves a tampered item, or one signed by another key, yields nothing. What an item holds is
 * the pair's ciphertext; opening it is the caller's business. Isomorphic: WebCrypto and `fetch`.
 */
import {
  BEP44_MAX_VALUE_BYTES,
  concatBytes,
  signMutableItem,
  verifyMutableItem,
  bep44SignedBytes,
  verifyEd25519,
  type IItemAddress,
  type IMutableItem,
} from './mesh-records.js';

export interface IRendezvousItemStore {
  /** Publish `value` at `address`, as of `now` (ms); rejects when no holder took it. */
  put(address: IItemAddress, value: Uint8Array, now: number, signal?: AbortSignal): Promise<void>;
  /** The verified value at `publicKey` and `salt`; `undefined` when none verifies. Never throws. */
  get(
    publicKey: Uint8Array,
    salt: Uint8Array,
    signal: AbortSignal,
  ): Promise<Uint8Array | undefined>;
  close(): void;
}

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

// ── In-process network, for tests and loopback ─────────────────────────────────────────────────

export interface IInMemoryItemNetwork {
  /** A store client attached to this network. */
  store(): IRendezvousItemStore;
  /** Every item the network holds, as stored. */
  items(): readonly IMutableItem[];
  /** Replace what the network serves (a hostile node): return the item to serve, or `undefined`. */
  serve(rewrite: (item: IMutableItem) => IMutableItem | undefined): void;
}

/**
 * An in-process item network with a DHT node's rules: it refuses an item whose signature does not
 * verify, and a sequence number lower than the one it holds.
 */
export function createInMemoryItemNetwork(): IInMemoryItemNetwork {
  const held = new Map<string, IMutableItem>();
  let rewrite: (item: IMutableItem) => IMutableItem | undefined = (item) => item;
  const target = (k: Uint8Array, salt: Uint8Array | undefined): string =>
    `${hex(k)}/${hex(salt ?? new Uint8Array(0))}`;
  return {
    store: () => ({
      async put(address, value, now) {
        const item = await signMutableItem(
          address.key,
          address.salt,
          Math.floor(now / 1000),
          value,
        );
        if (!(await verifyMutableItem(item, item.k, item.salt))) throw new Error('item refused');
        const at = target(item.k, item.salt);
        const current = held.get(at);
        if (current !== undefined && current.seq > item.seq)
          throw new Error('item refused: older seq');
        held.set(at, item);
      },
      async get(publicKey, salt) {
        await Promise.resolve();
        const stored = held.get(target(publicKey, salt));
        const served = stored === undefined ? undefined : rewrite(stored);
        if (served === undefined) return undefined;
        return (await verifyMutableItem(served, publicKey, salt)) ? served.v : undefined;
      },
      close: () => undefined,
    }),
    items: () => [...held.values()],
    serve: (next) => {
      rewrite = next;
    },
  };
}

// ── pkarr relays (HTTP), for clients that cannot reach the DHT ─────────────────────────────────

const Z_BASE32 = 'ybndrfg8ejkmcpqxot1uwisza345h769';

/** z-base-32, as pkarr names keys. */
export function zBase32(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += Z_BASE32[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += Z_BASE32[(buffer << (5 - bits)) & 31];
  return out;
}

const DNS_TYPE_TXT = 16;
const DNS_CLASS_IN = 1;
const TXT_TTL_S = 300;
const RECORD_LABEL = '_r';

function u16(value: number): Uint8Array {
  return Uint8Array.from([(value >>> 8) & 0xff, value & 0xff]);
}

/**
 * The DNS packet a pkarr relay carries: one TXT answer holding `value`. pkarr relays accept only a
 * DNS packet as the value, and no salt, so the pkarr form of a record is the salt-less item under
 * the same one-time key, whose value is this packet.
 */
export function encodePkarrPacket(publicKey: Uint8Array, value: Uint8Array): Uint8Array {
  const labels = [RECORD_LABEL, zBase32(publicKey)];
  const name = concatBytes([
    ...labels.flatMap((l) => [Uint8Array.of(l.length), new TextEncoder().encode(l)]),
    Uint8Array.of(0),
  ]);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < value.length; i += 255) {
    const part = value.subarray(i, i + 255);
    chunks.push(Uint8Array.of(part.length), part);
  }
  if (value.length === 0) chunks.push(Uint8Array.of(0));
  const rdata = concatBytes(chunks);
  return concatBytes([
    // id 0, flags: response + authoritative, 0 questions, 1 answer, 0 authority, 0 additional
    Uint8Array.from([0, 0, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 0]),
    name,
    u16(DNS_TYPE_TXT),
    u16(DNS_CLASS_IN),
    Uint8Array.from([0, 0, (TXT_TTL_S >>> 8) & 0xff, TXT_TTL_S & 0xff]),
    u16(rdata.length),
    rdata,
  ]);
}

/** The value of the first TXT answer of a pkarr packet; `undefined` when there is none. */
export function decodePkarrPacket(packet: Uint8Array): Uint8Array | undefined {
  const read16 = (at: number): number => ((packet[at] ?? 0) << 8) | (packet[at + 1] ?? 0);
  if (packet.length < 12) return undefined;
  const questions = read16(4);
  const answers = read16(6);
  let at = 12;
  const skipName = (): boolean => {
    for (let hops = 0; hops < 128; hops += 1) {
      const len = packet[at];
      if (len === undefined) return false;
      if (len === 0) {
        at += 1;
        return true;
      }
      if ((len & 0xc0) === 0xc0) {
        at += 2;
        return true;
      }
      at += 1 + len;
    }
    return false;
  };
  for (let q = 0; q < questions; q += 1) {
    if (!skipName()) return undefined;
    at += 4;
  }
  for (let a = 0; a < answers; a += 1) {
    if (!skipName() || at + 10 > packet.length) return undefined;
    const type = read16(at);
    const rdLength = read16(at + 8);
    const start = at + 10;
    const end = start + rdLength;
    if (end > packet.length) return undefined;
    if (type === DNS_TYPE_TXT) {
      const parts: Uint8Array[] = [];
      let p = start;
      while (p < end) {
        const len = packet[p]!;
        if (p + 1 + len > end) return undefined;
        parts.push(packet.subarray(p + 1, p + 1 + len));
        p += 1 + len;
      }
      return concatBytes(parts);
    }
    at = end;
  }
  return undefined;
}

export interface IPkarrRelayStoreOptions {
  /** Relay base URLs (`https://…`), each run by whoever the user chose; several operators. */
  readonly relays: readonly string[];
  /** Default: the global `fetch`. */
  readonly fetch?: typeof fetch;
}

const PKARR_CONTENT_TYPE = 'application/pkarr.org/relays#payload';
const SIG_BYTES = 64;
const SEQ_BYTES = 8;

function seqBytes(seq: number): Uint8Array {
  const out = new Uint8Array(SEQ_BYTES);
  new DataView(out.buffer).setBigUint64(0, BigInt(seq));
  return out;
}

/**
 * A store over several pkarr relays. A put goes to every relay and succeeds when one took it; a get
 * asks every relay and keeps the newest item that verifies. A relay is only a cache in front of the
 * DHT: it can withhold or serve stale items, never forge one.
 */
export function createPkarrRelayStore(options: IPkarrRelayStoreOptions): IRendezvousItemStore {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const urlOf = (relay: string, publicKey: Uint8Array): string =>
    `${relay.replace(/\/+$/, '')}/${zBase32(publicKey)}`;
  return {
    async put(address, value, now, signal) {
      const packet = encodePkarrPacket(address.key.publicKey, value);
      if (packet.length > BEP44_MAX_VALUE_BYTES)
        throw new Error('record too large for a pkarr relay');
      const seq = Math.floor(now) * 1000;
      const sig = await address.key.sign(bep44SignedBytes(undefined, seq, packet));
      const body = concatBytes([sig, seqBytes(seq), packet]);
      const results = await Promise.allSettled(
        options.relays.map(async (relay) => {
          const response = await doFetch(urlOf(relay, address.key.publicKey), {
            method: 'PUT',
            headers: { 'content-type': PKARR_CONTENT_TYPE },
            body: body.slice().buffer,
            ...(signal !== undefined ? { signal } : {}),
          });
          if (!response.ok) throw new Error(`pkarr relay refused (${response.status})`);
        }),
      );
      if (!results.some((r) => r.status === 'fulfilled')) {
        throw new Error('no pkarr relay took the record');
      }
    },
    async get(publicKey, _salt, signal) {
      const found = await Promise.all(
        options.relays.map(async (relay) => {
          try {
            const response = await doFetch(urlOf(relay, publicKey), { signal });
            if (!response.ok) return undefined;
            const body = new Uint8Array(await response.arrayBuffer());
            if (body.length <= SIG_BYTES + SEQ_BYTES || body.length > 1_200) return undefined;
            const sig = body.subarray(0, SIG_BYTES);
            const seq = Number(
              new DataView(body.buffer, body.byteOffset + SIG_BYTES, SEQ_BYTES).getBigUint64(0),
            );
            const packet = body.slice(SIG_BYTES + SEQ_BYTES);
            if (!Number.isSafeInteger(seq)) return undefined;
            if (!(await verifyEd25519(publicKey, bep44SignedBytes(undefined, seq, packet), sig))) {
              return undefined;
            }
            const value = decodePkarrPacket(packet);
            return value === undefined ? undefined : { seq, value };
          } catch {
            // allow-fallback: a relay that fails or times out has nothing; the others are asked too
            return undefined;
          }
        }),
      );
      let best: { seq: number; value: Uint8Array } | undefined;
      for (const entry of found)
        if (entry !== undefined && (best === undefined || entry.seq > best.seq)) best = entry;
      return best?.value;
    },
    close: () => undefined,
  };
}

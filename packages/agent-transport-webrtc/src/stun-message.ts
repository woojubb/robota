/**
 * STUN messages (RFC 8489) as TURN (RFC 8656) uses them over UDP: the header, the attributes a
 * relay reads and writes, MESSAGE-INTEGRITY with a long-term key, FINGERPRINT, and ChannelData.
 *
 * Everything decoded here is hostile input: a malformed message decodes to `undefined` rather than
 * throwing, and no length is trusted beyond the bytes actually received.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';

export const MAGIC_COOKIE = 0x2112a442;
const HEADER_BYTES = 20;
const MAX_MESSAGE_BYTES = 65_535;

export const StunMethod = {
  Binding: 0x001,
  Allocate: 0x003,
  Refresh: 0x004,
  Send: 0x006,
  Data: 0x007,
  CreatePermission: 0x008,
  ChannelBind: 0x009,
} as const;

export const StunClass = {
  Request: 0,
  Indication: 1,
  Success: 2,
  Error: 3,
} as const;
export type TStunClass = (typeof StunClass)[keyof typeof StunClass];

export const StunAttr = {
  MappedAddress: 0x0001,
  Username: 0x0006,
  MessageIntegrity: 0x0008,
  ErrorCode: 0x0009,
  UnknownAttributes: 0x000a,
  ChannelNumber: 0x000c,
  Lifetime: 0x000d,
  XorPeerAddress: 0x0012,
  Data: 0x0013,
  Realm: 0x0014,
  Nonce: 0x0015,
  XorRelayedAddress: 0x0016,
  RequestedAddressFamily: 0x0017,
  EvenPort: 0x0018,
  RequestedTransport: 0x0019,
  DontFragment: 0x001a,
  MessageIntegritySha256: 0x001c,
  PasswordAlgorithm: 0x001d,
  Userhash: 0x001e,
  XorMappedAddress: 0x0020,
  ReservationToken: 0x0022,
  Priority: 0x0024,
  UseCandidate: 0x0025,
  Fingerprint: 0x8028,
} as const;

export interface IStunAttribute {
  readonly type: number;
  readonly value: Buffer;
  /** Where the attribute's header starts in the message. */
  readonly offset: number;
}

export interface IStunMessage {
  readonly method: number;
  readonly cls: TStunClass;
  readonly transactionId: Buffer;
  readonly attributes: readonly IStunAttribute[];
  /** The whole message as received. */
  readonly raw: Buffer;
}

export interface ITransportAddress {
  readonly address: string;
  readonly port: number;
}

function messageType(method: number, cls: TStunClass): number {
  return (
    (method & 0x000f) |
    ((method & 0x0070) << 1) |
    ((method & 0x0f80) << 2) |
    ((cls & 1) << 4) |
    ((cls & 2) << 7)
  );
}

/** Whether the first bytes look like a STUN message (the two top bits zero, the magic cookie). */
export function isStunMessage(data: Buffer): boolean {
  return (
    data.length >= HEADER_BYTES && (data[0]! & 0xc0) === 0 && data.readUInt32BE(4) === MAGIC_COOKIE
  );
}

/** Decode a STUN message; `undefined` when it is not a well-formed one. */
export function decodeStun(data: Buffer): IStunMessage | undefined {
  if (!isStunMessage(data)) return undefined;
  const type = data.readUInt16BE(0);
  const length = data.readUInt16BE(2);
  if (length % 4 !== 0 || HEADER_BYTES + length > data.length) return undefined;
  const method = (type & 0x000f) | ((type & 0x00e0) >> 1) | ((type & 0x3e00) >> 2);
  const cls = (((type & 0x0010) >> 4) | ((type & 0x0100) >> 7)) as TStunClass;
  const attributes: IStunAttribute[] = [];
  let offset = HEADER_BYTES;
  const end = HEADER_BYTES + length;
  while (offset < end) {
    if (offset + 4 > end) return undefined;
    const attrType = data.readUInt16BE(offset);
    const attrLength = data.readUInt16BE(offset + 2);
    if (offset + 4 + attrLength > end) return undefined;
    attributes.push({
      type: attrType,
      value: data.subarray(offset + 4, offset + 4 + attrLength),
      offset,
    });
    offset += 4 + attrLength + ((4 - (attrLength % 4)) % 4);
  }
  if (offset !== end) return undefined;
  return {
    method,
    cls,
    transactionId: Buffer.from(data.subarray(8, 20)),
    attributes,
    raw: data.subarray(0, end),
  };
}

/** The first attribute of `type`, if any. */
export function attribute(message: IStunMessage, type: number): Buffer | undefined {
  return message.attributes.find((a) => a.type === type)?.value;
}

export function attributes(message: IStunMessage, type: number): Buffer[] {
  return message.attributes.filter((a) => a.type === type).map((a) => a.value);
}

/** Decode an XOR-*-ADDRESS value; `undefined` when malformed. */
export function decodeXorAddress(
  value: Buffer,
  transactionId: Buffer,
): ITransportAddress | undefined {
  if (value.length < 8) return undefined;
  const family = value[1];
  const port = value.readUInt16BE(2) ^ (MAGIC_COOKIE >>> 16);
  if (family === 0x01 && value.length === 8) {
    const raw = value.readUInt32BE(4) ^ MAGIC_COOKIE;
    const address = [raw >>> 24, (raw >>> 16) & 0xff, (raw >>> 8) & 0xff, raw & 0xff].join('.');
    return { address, port };
  }
  if (family === 0x02 && value.length === 20) {
    const mask = Buffer.alloc(16);
    mask.writeUInt32BE(MAGIC_COOKIE, 0);
    transactionId.copy(mask, 4);
    const groups: string[] = [];
    for (let i = 0; i < 16; i += 2) {
      groups.push(((value.readUInt16BE(4 + i) ^ mask.readUInt16BE(i)) & 0xffff).toString(16));
    }
    return { address: groups.join(':'), port };
  }
  return undefined;
}

function ipv6Bytes(address: string): Buffer {
  const [head = '', tail = ''] = address.split('::') as [string, string?];
  const left = head.length > 0 ? head.split(':') : [];
  const right = address.includes('::') && tail.length > 0 ? tail.split(':') : [];
  const groups = address.includes('::')
    ? [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right]
    : left;
  const out = Buffer.alloc(16);
  groups.forEach((group, i) => out.writeUInt16BE(parseInt(group, 16) & 0xffff, i * 2));
  return out;
}

/** Encode an address as an XOR-*-ADDRESS value. */
export function encodeXorAddress(address: ITransportAddress, transactionId: Buffer): Buffer {
  const port = (address.port ^ (MAGIC_COOKIE >>> 16)) & 0xffff;
  if (isIPv4(address.address)) {
    const out = Buffer.alloc(8);
    out[1] = 0x01;
    out.writeUInt16BE(port, 2);
    const raw = address.address.split('.').reduce((acc, part) => (acc << 8) | Number(part), 0);
    out.writeUInt32BE((raw ^ MAGIC_COOKIE) >>> 0, 4);
    return out;
  }
  if (!isIPv6(address.address)) throw new Error(`not an IP address: ${address.address}`);
  const out = Buffer.alloc(20);
  out[1] = 0x02;
  out.writeUInt16BE(port, 2);
  const mask = Buffer.alloc(16);
  mask.writeUInt32BE(MAGIC_COOKIE, 0);
  transactionId.copy(mask, 4);
  const bytes = ipv6Bytes(address.address);
  for (let i = 0; i < 16; i += 1) out[4 + i] = bytes[i]! ^ mask[i]!;
  return out;
}

/** The long-term credential key (RFC 8489 §9.2.2): MD5(username ":" realm ":" password). */
export function longTermKey(username: string, realm: string, password: string): Buffer {
  return createHash('md5').update(`${username}:${realm}:${password}`, 'utf8').digest();
}

/**
 * Whether the message carries a MESSAGE-INTEGRITY that `key` produced. Only the attributes before it
 * count, with the header length adjusted as the sender computed it.
 */
export function verifyIntegrity(message: IStunMessage, key: Buffer): boolean {
  const at = message.attributes.find((a) => a.type === StunAttr.MessageIntegrity);
  if (at === undefined || at.value.length !== 20) return false;
  const covered = Buffer.from(message.raw.subarray(0, at.offset));
  covered.writeUInt16BE(at.offset - HEADER_BYTES + 24, 2);
  const expected = createHmac('sha1', key).update(covered).digest();
  return timingSafeEqual(expected, at.value);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface IStunEncodeOptions {
  /** Append MESSAGE-INTEGRITY under this long-term key. */
  readonly integrityKey?: Buffer;
  /** Append FINGERPRINT (default true). */
  readonly fingerprint?: boolean;
}

/** Encode a STUN message. */
export function encodeStun(
  method: number,
  cls: TStunClass,
  transactionId: Buffer,
  attrs: readonly { readonly type: number; readonly value: Buffer }[],
  options: IStunEncodeOptions = {},
): Buffer {
  const parts: Buffer[] = [];
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt16BE(messageType(method, cls), 0);
  header.writeUInt32BE(MAGIC_COOKIE, 4);
  transactionId.copy(header, 8, 0, 12);
  parts.push(header);
  const push = (type: number, value: Buffer): void => {
    const head = Buffer.alloc(4);
    head.writeUInt16BE(type, 0);
    head.writeUInt16BE(value.length, 2);
    parts.push(head, value, Buffer.alloc((4 - (value.length % 4)) % 4));
  };
  for (const a of attrs) push(a.type, a.value);
  const current = (): Buffer => Buffer.concat(parts);
  if (options.integrityKey !== undefined) {
    const covered = current();
    covered.writeUInt16BE(covered.length - HEADER_BYTES + 24, 2);
    push(
      StunAttr.MessageIntegrity,
      createHmac('sha1', options.integrityKey).update(covered).digest(),
    );
  }
  if (options.fingerprint !== false) {
    const covered = current();
    covered.writeUInt16BE(covered.length - HEADER_BYTES + 8, 2);
    const value = Buffer.alloc(4);
    value.writeUInt32BE((crc32(covered) ^ 0x5354554e) >>> 0, 0);
    push(StunAttr.Fingerprint, value);
  }
  const out = current();
  out.writeUInt16BE(out.length - HEADER_BYTES, 2);
  if (out.length > MAX_MESSAGE_BYTES) throw new Error('STUN message too large');
  return out;
}

/** An ERROR-CODE value. */
export function errorCode(code: number, reason: string): Buffer {
  const text = Buffer.from(reason, 'utf8');
  const out = Buffer.alloc(4 + text.length);
  out[2] = Math.floor(code / 100);
  out[3] = code % 100;
  text.copy(out, 4);
  return out;
}

/** The code of an ERROR-CODE value; `undefined` when malformed. */
export function readErrorCode(value: Buffer | undefined): number | undefined {
  if (value === undefined || value.length < 4) return undefined;
  return (value[2]! & 0x07) * 100 + value[3]!;
}

export function uint32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value >>> 0, 0);
  return out;
}

/** Whether the first bytes are a ChannelData message (the two top bits `01`). */
export function isChannelData(data: Buffer): boolean {
  return data.length >= 4 && (data[0]! & 0xc0) === 0x40;
}

/** Channel numbers a client may bind (RFC 8656 §12). */
export const MIN_CHANNEL = 0x4000;
export const MAX_CHANNEL = 0x4fff;

export function decodeChannelData(
  data: Buffer,
): { readonly channel: number; readonly payload: Buffer } | undefined {
  if (!isChannelData(data)) return undefined;
  const channel = data.readUInt16BE(0);
  const length = data.readUInt16BE(2);
  if (4 + length > data.length) return undefined;
  return { channel, payload: data.subarray(4, 4 + length) };
}

export function encodeChannelData(channel: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16BE(channel, 0);
  header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload, Buffer.alloc((4 - (payload.length % 4)) % 4)]);
}

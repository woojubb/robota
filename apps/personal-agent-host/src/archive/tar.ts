/**
 * A small, dependency-free tar reader and writer: ustar headers, pax headers for names and links
 * that do not fit, and GNU long names on read. It decides nothing about what an archive may hold;
 * that is the validator's job. It refuses what it cannot parse exactly (a bad checksum, a number it
 * cannot read, a truncated archive) so a damaged archive never passes as a short one.
 */

const BLOCK = 512;
const MAX_EXTENDED_BYTES = 1024 * 1024;
const OCTAL_LIMIT = 8 ** 11;
const OCTAL_SMALL_LIMIT = 8 ** 7;

export type TarKind = 'file' | 'dir' | 'symlink' | 'hardlink' | 'other';

export interface ITarHeader {
  path: string;
  kind: TarKind;
  /** The type flag as written, for a refusal that names what was found. */
  flag: string;
  mode: number;
  uid: number;
  gid: number;
  size: number;
  mtime: number;
  linkname: string;
}

export class TarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TarError';
  }
}

// ---- reading -------------------------------------------------------------------------------

/** Bytes in pieces, from a stream or, for small cases, an array. */
export type ByteSource = AsyncIterable<Uint8Array> | Iterable<Uint8Array>;

async function* pieces(source: ByteSource): AsyncGenerator<Uint8Array> {
  for await (const chunk of source) yield chunk;
}

/** Pulls exact byte counts out of an async byte source. */
class Puller {
  private readonly iterator: AsyncIterator<Uint8Array>;
  private pending: Buffer = Buffer.alloc(0);
  private finished = false;

  constructor(source: ByteSource) {
    this.iterator = pieces(source)[Symbol.asyncIterator]();
  }

  private async fill(): Promise<boolean> {
    if (this.finished) return false;
    const next = await this.iterator.next();
    if (next.done) {
      this.finished = true;
      return false;
    }
    this.pending =
      this.pending.length === 0
        ? Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength)
        : Buffer.concat([this.pending, next.value]);
    return true;
  }

  /** Exactly `count` bytes, or fewer when the source ends first. */
  async take(count: number): Promise<Buffer> {
    while (this.pending.length < count) {
      if (!(await this.fill())) break;
    }
    const out = this.pending.subarray(0, count);
    this.pending = this.pending.subarray(out.length);
    return out;
  }

  /** At most `count` bytes of whatever is at hand; empty only at the end of the source. */
  async some(count: number): Promise<Buffer> {
    if (this.pending.length === 0) await this.fill();
    const out = this.pending.subarray(0, count);
    this.pending = this.pending.subarray(out.length);
    return out;
  }

  async skip(count: number): Promise<void> {
    let left = count;
    while (left > 0) {
      const chunk = await this.some(left);
      if (chunk.length === 0) throw new TarError('The archive is truncated');
      left -= chunk.length;
    }
  }

  async close(): Promise<void> {
    await this.iterator.return?.();
  }
}

function field(block: Buffer, start: number, length: number): Buffer {
  return block.subarray(start, start + length);
}

function text(buffer: Buffer): string {
  const end = buffer.indexOf(0);
  return buffer.subarray(0, end < 0 ? buffer.length : end).toString('utf8');
}

function number(buffer: Buffer, what: string): number {
  if ((buffer[0] & 0x80) !== 0) {
    // Base-256: a big-endian value with the top bit as a marker, for numbers octal cannot hold.
    let value = buffer[0] & 0x7f;
    for (let i = 1; i < buffer.length; i += 1) {
      value = value * 256 + buffer[i];
      if (!Number.isSafeInteger(value)) throw new TarError(`The ${what} field is out of range`);
    }
    return value;
  }
  const digits = text(buffer).trim();
  if (digits === '') return 0;
  if (!/^[0-7]+$/u.test(digits)) throw new TarError(`The ${what} field is not a number`);
  return parseInt(digits, 8);
}

function checksumOf(block: Buffer): number {
  let sum = 0;
  for (let i = 0; i < BLOCK; i += 1) sum += i >= 148 && i < 156 ? 0x20 : block[i];
  return sum;
}

function kindOf(flag: string): TarKind {
  switch (flag) {
    case '0':
    case '\0':
    case '7':
      return 'file';
    case '5':
      return 'dir';
    case '2':
      return 'symlink';
    case '1':
      return 'hardlink';
    default:
      return 'other';
  }
}

interface IPaxOverrides {
  path?: string;
  linkpath?: string;
  size?: number;
  uid?: number;
  gid?: number;
  mtime?: number;
}

function parsePax(data: Buffer): IPaxOverrides {
  const out: IPaxOverrides = {};
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space < 0) throw new TarError('A pax record is malformed');
    const length = Number(data.subarray(offset, space).toString('ascii'));
    if (!Number.isInteger(length) || length < space - offset + 2 || offset + length > data.length) {
      throw new TarError('A pax record is malformed');
    }
    const record = data.subarray(space + 1, offset + length - 1).toString('utf8');
    const eq = record.indexOf('=');
    if (eq < 0 || data[offset + length - 1] !== 0x0a) {
      throw new TarError('A pax record is malformed');
    }
    const key = record.slice(0, eq);
    const value = record.slice(eq + 1);
    const numeric = (): number => {
      if (!/^\d+(?:\.\d+)?$/u.test(value)) throw new TarError(`The pax ${key} is not a number`);
      return Math.floor(Number(value));
    };
    if (key === 'path') out.path = value;
    else if (key === 'linkpath') out.linkpath = value;
    else if (key === 'size') out.size = numeric();
    else if (key === 'uid') out.uid = numeric();
    else if (key === 'gid') out.gid = numeric();
    else if (key === 'mtime') out.mtime = numeric();
    offset += length;
  }
  return out;
}

export interface ITarEntry {
  header: ITarHeader;
  /** The entry's data. Unread data is skipped when the next entry is requested. */
  body(): AsyncGenerator<Buffer>;
}

/**
 * Reads entries one at a time. The generator ends only after the end-of-archive marker; a source
 * that stops without one is an error, so a truncated archive cannot look complete.
 */
export async function* readTar(source: ByteSource): AsyncGenerator<ITarEntry> {
  const puller = new Puller(source);
  let pax: IPaxOverrides = {};
  let longName: string | undefined;
  let longLink: string | undefined;
  try {
    for (;;) {
      const block = await puller.take(BLOCK);
      if (block.length === 0) throw new TarError('The archive ends without its end marker');
      if (block.length < BLOCK) throw new TarError('The archive is truncated');
      if (block.every((byte) => byte === 0)) {
        const second = await puller.take(BLOCK);
        if (second.length > 0 && !second.every((byte) => byte === 0)) {
          throw new TarError('The archive has data after its first end block');
        }
        return;
      }
      if (checksumOf(block) !== number(field(block, 148, 8), 'checksum')) {
        throw new TarError('A tar header has a bad checksum');
      }
      const flag = String.fromCharCode(block[156]);
      const size = number(field(block, 124, 12), 'size');
      if (flag === 'x' || flag === 'g' || flag === 'L' || flag === 'K') {
        if (size > MAX_EXTENDED_BYTES) throw new TarError('An extended header is too large');
        const data = await puller.take(size);
        if (data.length < size) throw new TarError('The archive is truncated');
        await puller.skip((BLOCK - (size % BLOCK)) % BLOCK);
        if (flag === 'x') pax = { ...pax, ...parsePax(data) };
        else if (flag === 'L') longName = text(data);
        else if (flag === 'K') longLink = text(data);
        // A global pax header is read and ignored: nothing here depends on it.
        continue;
      }
      const magic = field(block, 257, 6).toString('latin1');
      const prefix = magic === 'ustar\0' ? text(field(block, 345, 155)) : '';
      const name = text(field(block, 0, 100));
      const header: ITarHeader = {
        path: pax.path ?? longName ?? (prefix === '' ? name : `${prefix}/${name}`),
        kind: kindOf(flag),
        flag,
        mode: number(field(block, 100, 8), 'mode') & 0o7777,
        uid: pax.uid ?? number(field(block, 108, 8), 'uid'),
        gid: pax.gid ?? number(field(block, 116, 8), 'gid'),
        size: pax.size ?? size,
        mtime: pax.mtime ?? number(field(block, 136, 12), 'mtime'),
        linkname: pax.linkpath ?? longLink ?? text(field(block, 157, 100)),
      };
      pax = {};
      longName = undefined;
      longLink = undefined;
      // Only a regular file carries data; a size on any other entry is ignored by tar itself.
      const dataBytes = header.kind === 'file' || header.kind === 'other' ? header.size : 0;
      let left = dataBytes;
      yield {
        header,
        async *body() {
          while (left > 0) {
            const chunk = await puller.some(left);
            if (chunk.length === 0) throw new TarError('The archive is truncated');
            left -= chunk.length;
            yield chunk;
          }
        },
      };
      await puller.skip(left + ((BLOCK - (dataBytes % BLOCK)) % BLOCK));
    }
  } finally {
    await puller.close();
  }
}

// ---- writing -------------------------------------------------------------------------------

/** The end-of-archive marker: two zero blocks. */
export const TAR_TRAILER = Buffer.alloc(BLOCK * 2);

function put(block: Buffer, start: number, length: number, value: string): void {
  Buffer.from(value, 'utf8').copy(block, start, 0, length);
}

function octal(value: number, length: number): string {
  return `${value.toString(8).padStart(length - 1, '0')}\0`;
}

function typeFlag(kind: TarKind): string {
  switch (kind) {
    case 'file':
      return '0';
    case 'dir':
      return '5';
    case 'symlink':
      return '2';
    case 'hardlink':
      return '1';
    default:
      throw new TarError('Only files, directories and links can be written');
  }
}

function rawHeader(fields: {
  name: string;
  flag: string;
  mode: number;
  uid: number;
  gid: number;
  size: number;
  mtime: number;
  linkname: string;
}): Buffer {
  const block = Buffer.alloc(BLOCK);
  put(block, 0, 100, fields.name);
  put(block, 100, 8, octal(fields.mode & 0o7777, 8));
  put(block, 108, 8, octal(Math.min(fields.uid, OCTAL_SMALL_LIMIT - 1), 8));
  put(block, 116, 8, octal(Math.min(fields.gid, OCTAL_SMALL_LIMIT - 1), 8));
  put(block, 124, 12, octal(Math.min(fields.size, OCTAL_LIMIT - 1), 12));
  put(block, 136, 12, octal(Math.min(Math.max(fields.mtime, 0), OCTAL_LIMIT - 1), 12));
  block.fill(0x20, 148, 156);
  block[156] = fields.flag.charCodeAt(0);
  put(block, 157, 100, fields.linkname);
  put(block, 257, 6, 'ustar\0');
  put(block, 263, 2, '00');
  const sum = checksumOf(block);
  put(block, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);
  return block;
}

function paxRecord(key: string, value: string): Buffer {
  const body = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(body) + 1;
  // The length counts its own digits, so settle on the number that describes itself.
  while (String(length).length + Buffer.byteLength(body) !== length) {
    length = String(length).length + Buffer.byteLength(body);
  }
  return Buffer.from(`${length}${body}`, 'utf8');
}

function padTo(data: Buffer): Buffer {
  const rest = data.length % BLOCK;
  return rest === 0 ? data : Buffer.concat([data, Buffer.alloc(BLOCK - rest)]);
}

/** The header bytes for one entry: a pax header first when a field does not fit ustar. */
export function encodeHeader(header: ITarHeader): Buffer {
  const flag = typeFlag(header.kind);
  const records: Buffer[] = [];
  const name =
    header.kind === 'dir' && !header.path.endsWith('/') ? `${header.path}/` : header.path;
  if (Buffer.byteLength(name) > 100) records.push(paxRecord('path', name));
  if (Buffer.byteLength(header.linkname) > 100)
    records.push(paxRecord('linkpath', header.linkname));
  if (header.size >= OCTAL_LIMIT) records.push(paxRecord('size', String(header.size)));
  if (header.uid >= OCTAL_SMALL_LIMIT) records.push(paxRecord('uid', String(header.uid)));
  if (header.gid >= OCTAL_SMALL_LIMIT) records.push(paxRecord('gid', String(header.gid)));
  const main = rawHeader({
    name,
    flag,
    mode: header.mode,
    uid: header.uid,
    gid: header.gid,
    size: header.kind === 'file' ? header.size : 0,
    mtime: header.mtime,
    linkname: header.linkname,
  });
  if (records.length === 0) return main;
  const data = Buffer.concat(records);
  const extended = rawHeader({
    name: 'PaxHeader',
    flag: 'x',
    mode: 0o644,
    uid: 0,
    gid: 0,
    size: data.length,
    mtime: header.mtime,
    linkname: '',
  });
  return Buffer.concat([extended, padTo(data), main]);
}

/** A header exactly as given, whatever it says, for tests that need an archive nothing should accept. */
export function encodeRawHeader(fields: {
  name: string;
  flag: string;
  mode?: number;
  size?: number;
  linkname?: string;
}): Buffer {
  return rawHeader({
    name: fields.name,
    flag: fields.flag,
    mode: fields.mode ?? 0o644,
    uid: 0,
    gid: 0,
    size: fields.size ?? 0,
    mtime: 0,
    linkname: fields.linkname ?? '',
  });
}

/** The bytes after a file's data that bring it to a whole block. */
export function dataPadding(size: number): Buffer {
  return Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);
}

/** One whole entry as bytes, for small data held in memory. */
export function encodeEntry(header: ITarHeader, data: Buffer = Buffer.alloc(0)): Buffer {
  const sized = header.kind === 'file' ? { ...header, size: data.length } : header;
  return Buffer.concat([
    encodeHeader(sized),
    data,
    header.kind === 'file' ? dataPadding(data.length) : Buffer.alloc(0),
  ]);
}

/**
 * Rewrites an archive entry by entry. `map` returns the header to write, or `undefined` to drop the
 * entry; a file keeps its data, so its size must not change.
 */
export async function* rewriteTar(
  source: ByteSource,
  map: (header: ITarHeader) => ITarHeader | undefined,
): AsyncGenerator<Buffer> {
  for await (const entry of readTar(source)) {
    const next = map(entry.header);
    if (next === undefined) continue;
    if (next.kind === 'other') {
      throw new TarError(
        `The entry ${JSON.stringify(next.path.slice(0, 120))} is a device, a FIFO or another special file, which a backup never holds`,
      );
    }
    if (next.kind === 'file' && next.size !== entry.header.size) {
      throw new TarError('A rewritten file must keep its size');
    }
    yield encodeHeader(next);
    if (next.kind === 'file') {
      for await (const chunk of entry.body()) yield chunk;
      yield dataPadding(next.size);
    }
  }
  yield TAR_TRAILER;
}

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { type FileHandle, open, stat } from 'node:fs/promises';

import { IMAGE_ID } from '../config.js';
import {
  type ByteSource,
  dataPadding,
  encodeEntry,
  encodeHeader,
  type ITarHeader,
  readTar,
  rewriteTar,
  TAR_TRAILER,
  TarError,
} from './tar.js';

/**
 * The backup of one account's state. A manifest entry comes first, then every entry of the state
 * directory below `state/`. Nothing in an archive is trusted until the whole of it has been read
 * and checked, because restoring one replaces an account's state.
 */

export const MANIFEST_NAME = 'manifest.json';
export const STATE_PREFIX = 'state/';
const FORMAT = 1;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_PATH_BYTES = 4096;
const MAX_NAME_BYTES = 255;
const MAX_LINK_BYTES = 1024;
const MAX_ENTRIES = 200_000;
const ACCOUNT = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

/** Whether a string holds a control character or a backslash, neither of which a name may carry. */
function hasControl(text: string): boolean {
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || char === '\\') return true;
  }
  return false;
}

/** An archive that cannot be accepted, with the reason in words an operator can act on. */
export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveError';
  }
}

export interface IBackupManifest {
  format: typeof FORMAT;
  account: string;
  hostname: string;
  imageId: string;
  createdAt: string;
  /** SHA-256 over the state entries as normalized by `digestEntry`; mtimes and owners excluded. */
  contentSha256: string;
  entries: number;
  bytes: number;
}

export interface IArchiveLimits {
  /** The most bytes an archive may have, as written. */
  maxBytes: number;
}

/** A path named in a message, shown quoted and cut, so odd bytes cannot reshape the line. */
function shown(value: string): string {
  const quoted = JSON.stringify(value);
  return quoted.length > 120 ? `${quoted.slice(0, 117)}..."` : quoted;
}

/** The parts of a relative path, refusing anything that is not a plain descent. */
function components(path: string, what: string): string[] {
  if (path === '') throw new ArchiveError(`${what} is empty`);
  if (Buffer.byteLength(path) > MAX_PATH_BYTES) throw new ArchiveError(`${what} is too long`);
  if (path.startsWith('/')) throw new ArchiveError(`${what} ${shown(path)} is an absolute path`);
  if (hasControl(path)) {
    throw new ArchiveError(`${what} ${shown(path)} has a control or backslash character`);
  }
  const parts = path.split('/');
  for (const part of parts) {
    if (part === '..') throw new ArchiveError(`${what} ${shown(path)} climbs out with ".."`);
    if (part === '.' || part === '') {
      throw new ArchiveError(`${what} ${shown(path)} is not a plain relative path`);
    }
    if (Buffer.byteLength(part) > MAX_NAME_BYTES) throw new ArchiveError(`${what} is too long`);
  }
  return parts;
}

/**
 * A link target must stay inside the state directory by reading alone: any number of `..` first,
 * never more than the link's own depth, and none after the first name. With no link allowed
 * above another entry (see `Checker`), that reading is also where the link points.
 */
function checkLinkTarget(depth: number, target: string, path: string): void {
  if (target === '') throw new ArchiveError(`The link ${shown(path)} has no target`);
  if (Buffer.byteLength(target) > MAX_LINK_BYTES) {
    throw new ArchiveError(`The link ${shown(path)} has a target that is too long`);
  }
  if (target.startsWith('/')) {
    throw new ArchiveError(`The link ${shown(path)} points to an absolute path`);
  }
  if (hasControl(target)) {
    throw new ArchiveError(`The link ${shown(path)} has a control or backslash character`);
  }
  let ups = 0;
  let descended = false;
  for (const part of target.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (descended) {
        throw new ArchiveError(`The link ${shown(path)} climbs back up after descending`);
      }
      ups += 1;
      continue;
    }
    descended = true;
  }
  if (ups > depth) {
    throw new ArchiveError(`The link ${shown(path)} points outside the state directory`);
  }
}

type SeenKind = 'file' | 'dir' | 'symlink' | 'hardlink';

/** What a canonical entry is: its path relative to the state directory, and nothing else of the archive. */
export interface ICanonicalEntry {
  path: string;
  kind: 'file' | 'dir' | 'symlink' | 'hardlink';
  mode: number;
  size: number;
  mtime: number;
  linkname: string;
}

/**
 * Checks canonical entries one by one against what came before: each path once, nothing below a
 * file or a link, a hard link only to a regular file the archive itself holds, no devices or
 * FIFOs, and the size and entry caps.
 */
class Checker {
  private readonly seen = new Map<string, SeenKind>();
  private readonly hash = createHash('sha256');
  entries = 0;
  bytes = 0;

  accept(header: ITarHeader): ICanonicalEntry {
    if (header.kind === 'other') {
      throw new ArchiveError(
        `The entry ${shown(header.path)} is a device, a FIFO or another special file, which a backup never holds`,
      );
    }
    const isDir = header.kind === 'dir';
    const raw = isDir && header.path.endsWith('/') ? header.path.slice(0, -1) : header.path;
    const parts = components(raw, 'The entry path');
    const path = parts.join('/');
    this.entries += 1;
    if (this.entries > MAX_ENTRIES) throw new ArchiveError('The archive has too many entries');

    for (let depth = 1; depth < parts.length; depth += 1) {
      const parent = parts.slice(0, depth).join('/');
      const kind = this.seen.get(parent);
      if (kind === undefined) this.seen.set(parent, 'dir');
      else if (kind !== 'dir') {
        throw new ArchiveError(
          `The entry ${shown(path)} lies below ${shown(parent)}, which is not a directory`,
        );
      }
    }
    const before = this.seen.get(path);
    if (before !== undefined && !(isDir && before === 'dir')) {
      throw new ArchiveError(`The entry ${shown(path)} appears twice`);
    }

    let linkname = '';
    if (header.kind === 'symlink') {
      checkLinkTarget(parts.length - 1, header.linkname, path);
      linkname = header.linkname;
    } else if (header.kind === 'hardlink') {
      const target = header.linkname;
      const targetParts = components(target, 'The hard link target');
      const normalized = targetParts.join('/');
      if (this.seen.get(normalized) !== 'file') {
        throw new ArchiveError(
          `The hard link ${shown(path)} points to ${shown(target)}, which is not a file earlier in the archive`,
        );
      }
      linkname = normalized;
    }
    this.seen.set(path, header.kind);
    const size = header.kind === 'file' ? header.size : 0;
    this.bytes += size;
    const entry: ICanonicalEntry = {
      path,
      kind: header.kind,
      mode: header.mode & 0o777,
      size,
      mtime: header.mtime,
      linkname,
    };
    this.hash.update(
      `${JSON.stringify([entry.kind, entry.path, entry.mode, entry.linkname, entry.size])}\n`,
    );
    return entry;
  }

  data(chunk: Buffer): void {
    this.hash.update(chunk);
  }

  digest(): string {
    return this.hash.digest('hex');
  }
}

function canonicalHeader(entry: ICanonicalEntry, prefix: string): ITarHeader {
  return {
    path: `${prefix}${entry.path}`,
    kind: entry.kind,
    flag: '',
    mode: entry.mode,
    uid: 0,
    gid: 0,
    size: entry.size,
    mtime: entry.mtime,
    linkname: entry.kind === 'hardlink' ? `${prefix}${entry.linkname}` : entry.linkname,
  };
}

function wrap<T>(task: Promise<T>): Promise<T> {
  return task.catch((error: unknown) => {
    if (error instanceof TarError) throw new ArchiveError(error.message);
    throw error;
  });
}

async function writeAll(handle: FileHandle, chunk: Buffer): Promise<void> {
  let offset = 0;
  while (offset < chunk.length) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
    offset += bytesWritten;
  }
}

export interface IStoredBody {
  contentSha256: string;
  entries: number;
  bytes: number;
  /** Bytes in the file: the state entries as written, without manifest or end marker. */
  size: number;
}

/**
 * Reads the state directory as a tar (entries relative to it, as a runtime reports them), checks
 * every entry the same way a restore will, and stores the normalized entries below `state/` in
 * `file`. Owners are dropped (the restore sets the unit's own).
 */
export function storeState(
  source: ByteSource,
  file: string,
  limits: IArchiveLimits,
): Promise<IStoredBody> {
  return wrap(
    (async () => {
      const checker = new Checker();
      const handle = await open(file, 'w', 0o600);
      let size = 0;
      try {
        const put = async (chunk: Buffer): Promise<void> => {
          size += chunk.length;
          if (size > limits.maxBytes) {
            throw new ArchiveError(
              `The state is larger than the backup limit of ${limits.maxBytes} bytes; ` +
                'raise PERSONAL_AGENT_HOST_BACKUP_MAX_BYTES to back it up',
            );
          }
          await writeAll(handle, chunk);
        };
        for await (const entry of readTar(source)) {
          const canonical = checker.accept(entry.header);
          await put(encodeHeader(canonicalHeader(canonical, STATE_PREFIX)));
          if (canonical.kind === 'file') {
            for await (const chunk of entry.body()) {
              checker.data(chunk);
              await put(chunk);
            }
            await put(dataPadding(canonical.size));
          }
        }
      } finally {
        await handle.close();
      }
      return {
        contentSha256: checker.digest(),
        entries: checker.entries,
        bytes: checker.bytes,
        size,
      };
    })(),
  );
}

export interface IManifestFields {
  account: string;
  hostname: string;
  imageId: string;
  createdAt: string;
}

/** The byte length of the finished archive, known before it is streamed. */
export function archiveSize(body: IStoredBody, fields: IManifestFields): number {
  return manifestBytes(body, fields).length + body.size + TAR_TRAILER.length;
}

function manifestBytes(body: IStoredBody, fields: IManifestFields): Buffer {
  const manifest: IBackupManifest = {
    format: FORMAT,
    ...fields,
    contentSha256: body.contentSha256,
    entries: body.entries,
    bytes: body.bytes,
  };
  const data = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return encodeEntry(
    {
      path: MANIFEST_NAME,
      kind: 'file',
      flag: '0',
      mode: 0o600,
      uid: 0,
      gid: 0,
      size: data.length,
      mtime: 0,
      linkname: '',
    },
    data,
  );
}

/** The finished archive as a stream: manifest, then the stored entries, then the end marker. */
export async function* archiveStream(
  file: string,
  body: IStoredBody,
  fields: IManifestFields,
): AsyncGenerator<Buffer> {
  yield manifestBytes(body, fields);
  for await (const chunk of createReadStream(file)) yield chunk as Buffer;
  yield TAR_TRAILER;
}

function parseManifest(data: Buffer): IBackupManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString('utf8'));
  } catch {
    throw new ArchiveError('The manifest is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ArchiveError('The manifest is not a JSON object');
  }
  const m = parsed as Record<string, unknown>;
  const str = (name: string): string => {
    const value = m[name];
    if (typeof value !== 'string') throw new ArchiveError(`The manifest has no "${name}"`);
    return value;
  };
  const count = (name: string): number => {
    const value = m[name];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw new ArchiveError(`The manifest has no valid "${name}"`);
    }
    return value;
  };
  if (m.format !== FORMAT) throw new ArchiveError('The archive has an unknown format version');
  const account = str('account');
  if (!ACCOUNT.test(account)) throw new ArchiveError('The manifest names an invalid account');
  const hostname = str('hostname');
  if (hostname.length === 0 || hostname.length > 253 || hasControl(hostname)) {
    throw new ArchiveError('The manifest has an invalid hostname');
  }
  const imageId = str('imageId');
  if (!IMAGE_ID.test(imageId)) throw new ArchiveError('The manifest has an invalid image id');
  const createdAt = str('createdAt');
  if (Number.isNaN(Date.parse(createdAt)) || createdAt.length > 40) {
    throw new ArchiveError('The manifest has an invalid creation time');
  }
  const contentSha256 = str('contentSha256');
  if (!/^[0-9a-f]{64}$/u.test(contentSha256)) {
    throw new ArchiveError('The manifest has an invalid content hash');
  }
  return {
    format: FORMAT,
    account,
    hostname,
    imageId,
    createdAt,
    contentSha256,
    entries: count('entries'),
    bytes: count('bytes'),
  };
}

function withinState(path: string, what: string): string {
  if (!path.startsWith(STATE_PREFIX) || path.length === STATE_PREFIX.length) {
    throw new ArchiveError(`${what} ${shown(path)} lies outside ${STATE_PREFIX}`);
  }
  return path.slice(STATE_PREFIX.length);
}

/** Header of an entry of an archive, moved from `state/…` to the state directory's own paths. */
function toCanonical(header: ITarHeader): ITarHeader {
  return {
    ...header,
    path: withinState(
      header.path.endsWith('/') ? header.path.slice(0, -1) : header.path,
      'The entry',
    ),
    linkname:
      header.kind === 'hardlink'
        ? withinState(header.linkname, 'The hard link target')
        : header.linkname,
  };
}

/**
 * Reads a whole archive and accepts it only if every rule holds: the manifest first, every other
 * entry below `state/`, every entry valid, and the manifest's hash and counts equal to what was
 * read. Nothing is replaced by the caller before this returns.
 */
export function verifyArchive(file: string, limits: IArchiveLimits): Promise<IBackupManifest> {
  return wrap(
    (async () => {
      const { size } = await stat(file);
      if (size > limits.maxBytes) {
        throw new ArchiveError(`The archive is larger than the limit of ${limits.maxBytes} bytes`);
      }
      const checker = new Checker();
      let manifest: IBackupManifest | undefined;
      for await (const entry of readTar(createReadStream(file))) {
        if (manifest === undefined) {
          const { header } = entry;
          if (header.path !== MANIFEST_NAME || header.kind !== 'file') {
            throw new ArchiveError('The archive does not start with its manifest');
          }
          if (header.size > MAX_MANIFEST_BYTES) throw new ArchiveError('The manifest is too large');
          const parts: Buffer[] = [];
          for await (const chunk of entry.body()) parts.push(chunk);
          manifest = parseManifest(Buffer.concat(parts));
          continue;
        }
        const canonical = checker.accept(toCanonical(entry.header));
        if (canonical.kind === 'file') {
          for await (const chunk of entry.body()) checker.data(chunk);
        }
      }
      if (manifest === undefined) throw new ArchiveError('The archive has no manifest');
      if (
        checker.digest() !== manifest.contentSha256 ||
        checker.entries !== manifest.entries ||
        checker.bytes !== manifest.bytes
      ) {
        throw new ArchiveError('The archive does not match its manifest: its content hash differs');
      }
      return manifest;
    })(),
  );
}

/**
 * The state entries of a verified archive as a tar relative to the state directory, owners
 * dropped, for a runtime to put in place. Call only on a file `verifyArchive` accepted.
 */
export function stateEntries(file: string): AsyncGenerator<Buffer> {
  let first = true;
  return rewriteTar(createReadStream(file), (header) => {
    if (first) {
      first = false;
      return undefined;
    }
    return { ...toCanonical(header), uid: 0, gid: 0, mode: header.mode & 0o777 };
  });
}

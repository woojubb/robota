/**
 * Where files other sessions send are kept: `~/.robota/peer-files/<sender>/<name>`, one directory
 * per sender, owned by this user and closed to everyone else.
 *
 * A received file is inert. It is written without execute permission, it is never opened by anything
 * here once kept, and it reaches the model only if someone later reads it through the session's
 * ordinary tools. The name is the sender's and is treated as hostile: it may not name a directory,
 * climb out of the sender's directory, land on a symbolic link, or replace a file already there.
 * Content goes to a private temporary file first and takes its name only once verified, so a partial
 * or wrong file never appears under a name.
 */

import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, unlink, type FileHandle } from 'node:fs/promises';
import path from 'node:path';

import type { IFileSink, TFileAdmission } from '@robota-sdk/agent-transport/node';

const PEER_FILES_DIRECTORY = 'peer-files';
const MAX_NAME_BYTES = 200;
const PARTIAL_PREFIX = '.partial-';

/** Code points that could repaint a terminal, hide text or reorder it. */
const UNPRINTABLE_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];

/** `text` without code points that could repaint a terminal, hide text or reorder it. */
export function withoutUnprintable(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (!UNPRINTABLE_RANGES.some(([low, high]) => code >= low && code <= high)) out += char;
  }
  return out;
}

/**
 * The name a received file is kept under, or `undefined` when the sender's name cannot be one.
 *
 * A name that tries to leave the directory is refused rather than cut down to its last segment: a
 * sender writing `../x` is not naming `x`, and quietly keeping it as `x` would hide the attempt.
 */
export function sanitizeReceivedFileName(raw: string): string | undefined {
  if (raw.includes('/') || raw.includes('\\')) return undefined;
  let name = withoutUnprintable(raw.normalize('NFC')).trim();
  if (name === '' || name === '.' || name === '..') return undefined;
  // Hidden files stay visible, and nothing received can take the temporary files' names.
  if (name.startsWith('.')) name = `_${name}`;
  if (Buffer.byteLength(name, 'utf8') > MAX_NAME_BYTES) return undefined;
  return name;
}

/**
 * A directory key for a sender: its id when that is already a plain token, otherwise a hash of it,
 * so no sender id can shape a path.
 */
export function senderDirectoryName(senderId: string): string {
  if (/^[A-Za-z0-9_-]{1,128}$/.test(senderId)) return senderId;
  return `id-${createHash('sha256').update(senderId).digest('hex').slice(0, 32)}`;
}

/** A directory this user owns and no one else can enter, created when absent. Throws otherwise. */
async function ownedDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`${directory} is not a plain directory`);
  }
  const uid = process.getuid?.();
  if (uid !== undefined && info.uid !== uid) throw new Error(`${directory} is not this user's`);
  if ((info.mode & 0o077) !== 0) throw new Error(`${directory} is open to other users`);
}

async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export interface IQuarantineOptions {
  /** `~/.robota` of this session's `HOME`. */
  readonly root: string;
  /** Who sent it: a device id, or a session id on this host. */
  readonly senderId: string;
  /** The sender's name for the file. */
  readonly name: string;
}

/** The place a received file would be kept, before anyone is asked about it. */
export type TQuarantineTarget =
  | { readonly ok: true; readonly directory: string; readonly name: string; readonly file: string }
  | Extract<TFileAdmission, { readonly refused: unknown }>;

/**
 * Where a file offered under `name` would be kept, or why it cannot be. Checked before the operator
 * is asked, so nobody approves a transfer that could not be kept.
 */
export async function quarantineTarget(options: IQuarantineOptions): Promise<TQuarantineTarget> {
  const name = sanitizeReceivedFileName(options.name);
  if (name === undefined) {
    return { refused: 'bad-name', detail: 'the file name is empty or leaves its directory' };
  }
  const base = path.join(options.root, PEER_FILES_DIRECTORY);
  const directory = path.join(base, senderDirectoryName(options.senderId));
  try {
    await mkdir(options.root, { recursive: true, mode: 0o700 });
    await ownedDirectory(base);
    await ownedDirectory(directory);
  } catch (error) {
    return {
      refused: 'unsafe-path',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  const file = path.join(directory, name);
  if (path.dirname(file) !== directory) {
    return { refused: 'bad-name', detail: 'the file name leaves its directory' };
  }
  if (await exists(file)) {
    return { refused: 'exists', detail: `${name} was already received; nothing is overwritten` };
  }
  return { ok: true, directory, name, file };
}

/**
 * Open a sink that keeps the verified content at `target.file`. Nothing is written under that name
 * until `commit`, and `commit` refuses to replace anything that appeared there meanwhile.
 */
export async function openQuarantineSink(
  target: Extract<TQuarantineTarget, { readonly ok: true }>,
): Promise<IFileSink> {
  const partial = path.join(target.directory, `${PARTIAL_PREFIX}${randomUUID()}`);
  const handle: FileHandle = await open(
    partial,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await handle.close();
  };
  return {
    write: async (chunk) => {
      await handle.write(chunk);
    },
    commit: async () => {
      await handle.sync();
      await close();
      try {
        // A hard link fails when the name exists, whatever is there — a file, or a link planted to
        // redirect the write — so the verified content takes the name only if nothing holds it.
        await link(partial, target.file);
      } finally {
        await unlink(partial).catch(() => undefined);
      }
      return target.file;
    },
    discard: async () => {
      // allow-fallback: discarding is cleanup after a failure that is already being reported.
      await close().catch(() => undefined);
      await unlink(partial).catch(() => undefined);
    },
  };
}

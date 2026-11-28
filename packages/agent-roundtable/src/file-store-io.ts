import { randomUUID } from 'node:crypto';
import { link, open, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

/** Named points in a file write at which a test can end the process. */
export type FileStoreCheckpoint =
  'temp-write' | 'temp-synced' | 'linked' | 'claim-write' | 'claim-synced' | 'claim-linked';

export type CheckpointHook = (point: FileStoreCheckpoint) => void | Promise<void>;

export const OWNER_ONLY_FILE = 0o600;
export const OWNER_ONLY_DIRECTORY = 0o700;

const TEMP_PREFIX = '.tmp-';

export function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

/** A name no reader mistakes for data; its owner process id lets a later open clean it up. */
export function tempPath(directory: string, label = ''): string {
  return join(directory, `${TEMP_PREFIX}${process.pid}-${label}${randomUUID()}`);
}

export function isTempName(name: string): boolean {
  return name.startsWith(TEMP_PREFIX);
}

export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== 'ESRCH';
  }
}

/** Writes `bytes[from, to)`, looping over short writes. */
async function writeFully(
  handle: Awaited<ReturnType<typeof open>>,
  bytes: Buffer,
  from: number,
  to: number,
): Promise<void> {
  let offset = from;
  while (offset < to) {
    const { bytesWritten } = await handle.write(bytes, offset, to - offset);
    offset += bytesWritten;
  }
}

/**
 * Creates `path` exclusively with owner-only mode, writes `data` in two halves (a test can end the
 * process between them), and flushes it before returning. A failure removes the file again.
 */
export async function writeSyncedTemp(
  path: string,
  data: string,
  points: { written: FileStoreCheckpoint; synced: FileStoreCheckpoint },
  checkpoint: CheckpointHook | undefined,
): Promise<void> {
  const bytes = Buffer.from(data, 'utf8');
  const middle = Math.floor(bytes.length / 2);
  const handle = await open(path, 'wx', OWNER_ONLY_FILE);
  try {
    try {
      await writeFully(handle, bytes, 0, middle);
      await checkpoint?.(points.written);
      await writeFully(handle, bytes, middle, bytes.length);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await checkpoint?.(points.synced);
  } catch (error) {
    await unlink(path).catch(() => undefined);
    throw error;
  }
}

/** The create-only publish: `final` either appears complete or already existed. */
export async function linkExclusive(temp: string, final: string): Promise<'created' | 'exists'> {
  try {
    await link(temp, final);
    return 'created';
  } catch (error) {
    if (errorCode(error) === 'EEXIST') return 'exists';
    throw error;
  }
}

/**
 * Makes a directory entry durable. Windows cannot open a directory for this, and some file
 * systems refuse the flush; both are tolerated because nothing more can be asked of them.
 */
export async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === 'win32') return;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch (error) {
    const code = errorCode(error);
    if (code !== 'EINVAL' && code !== 'ENOTSUP' && code !== 'EPERM' && code !== 'EISDIR') {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

/** Removes temp files left by processes that no longer exist; a live process's file is never touched. */
export async function sweepDeadTemps(directory: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return;
  }
  for (const name of names) {
    if (!isTempName(name)) continue;
    const pid = Number(/^\.tmp-(\d+)-/u.exec(name)?.[1]);
    if (Number.isSafeInteger(pid) && !processIsAlive(pid)) {
      await unlink(join(directory, name)).catch(() => undefined);
    }
  }
}

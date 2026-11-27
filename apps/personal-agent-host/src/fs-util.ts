import { randomBytes } from 'node:crypto';
import { chmod, mkdir, open, rename, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

import { HostError } from './errors.js';

export const PRIVATE_FILE_MODE = 0o600;
export const PRIVATE_DIR_MODE = 0o700;

/** Creates a directory that only its owner can enter, tightening one that already exists. */
export async function ensurePrivateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  await chmod(dir, PRIVATE_DIR_MODE);
}

async function syncDirectory(dir: string): Promise<void> {
  try {
    const handle = await open(dir, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Some filesystems cannot sync a directory; the rename itself is already atomic.
  }
}

/** Writes a file so a reader sees the old content or the new, never a partial file. */
export async function writeFileAtomic(
  path: string,
  data: string,
  mode: number = PRIVATE_FILE_MODE,
): Promise<void> {
  const temp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const handle = await open(temp, 'wx', mode);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  await handle.close();
  try {
    await chmod(temp, mode);
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  await syncDirectory(dirname(path));
}

/** Refuses a file that group or others can touch. Skipped where the platform has no such modes. */
export async function assertOwnerOnly(path: string, label: string): Promise<void> {
  if (process.platform === 'win32') return;
  const { mode } = await stat(path);
  if ((mode & 0o077) !== 0) {
    throw new HostError(
      'store-corrupt',
      `${label} ${path} is accessible to other users (mode ${(mode & 0o777).toString(8)}); run chmod 600 on it`,
    );
  }
}

export function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

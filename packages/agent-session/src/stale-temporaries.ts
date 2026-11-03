/**
 * Temporary files a crashed write left in a store directory of the user state (#3679): an atomic
 * owner-only write's `<name>.<pid>.tmp`, and an append-file rewrite's `.<name>.<pid>.<hex>.tmp`. Such
 * a file may hold a whole record in plaintext, and nothing ever reads or removes it.
 *
 * A write takes milliseconds, so a temp file five minutes older than its directory's last change is
 * a crash's; the age is judged by the filesystem's clock, never this process's. A directory nothing
 * changed in since the crash would keep its temp file forever by that rule, so a migration also
 * judges it against when the migration started, as its marker's time on the filesystem says. A temp
 * file of this process is never one. Only regular files are considered, and links are never followed.
 */
import { lstatSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const STALE_TEMPORARY_AGE_MS = 5 * 60 * 1000;
const OWNER_ONLY_TEMPORARY = /^.+\.(\d{1,10})\.tmp$/u;
const REWRITE_TEMPORARY = /^\..+\.(\d{1,10})\.[0-9a-f]{12}\.tmp$/u;

function ownerPidOf(name: string): number | undefined {
  const digits = (REWRITE_TEMPORARY.exec(name) ?? OWNER_ONLY_TEMPORARY.exec(name))?.[1];
  return digits === undefined ? undefined : Number(digits);
}

/**
 * The stale temp files in `directory`, removed when `apply` is set; returns how many there were.
 * `migrationStartedAt` is when a migration started, in milliseconds by the filesystem's clock; a temp
 * file older than it or than the directory's last change by the stale age is stale. A directory that
 * is missing or is not a real directory has none.
 */
export function sweepStaleStoreTemporaries(
  directory: string,
  apply: boolean,
  migrationStartedAt?: number,
): number {
  let now: number;
  let names: string[];
  try {
    const metadata = lstatSync(directory);
    if (!metadata.isDirectory()) return 0;
    now = Math.max(metadata.mtimeMs, migrationStartedAt ?? Number.NEGATIVE_INFINITY);
    names = readdirSync(directory);
  } catch {
    return 0; // allow-fallback: a directory that cannot be listed has nothing to sweep.
  }
  let swept = 0;
  for (const name of names) {
    const pid = ownerPidOf(name);
    if (pid === undefined || pid === process.pid) continue;
    const path = join(directory, name);
    try {
      const metadata = lstatSync(path);
      if (!metadata.isFile() || now - metadata.mtimeMs <= STALE_TEMPORARY_AGE_MS) continue;
      if (apply) unlinkSync(path);
      swept += 1;
    } catch {
      // allow-fallback: one removed meanwhile, or one that cannot be removed, is retried next time.
    }
  }
  return swept;
}

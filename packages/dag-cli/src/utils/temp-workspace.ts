import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Run `fn` against a freshly created, private temporary directory (SEC-003).
 *
 * The OS temp dir is world-writable (mode `0777` + sticky), so a file placed there by
 * string-joining a name onto `os.tmpdir()` is created world-readable (`0666 & ~umask`,
 * typically `0644`) at a path another local user can guess and pre-create. That is CWE-377:
 * any local user can read the contents, or win the race and have the CLI write through a
 * symlink they planted.
 *
 * `mkdtemp` is the correct mitigation: the kernel creates the directory with mode `0700` and
 * a name it chooses, so nothing inside is reachable by another user and there is no path to
 * pre-create. Callers must place temp files *inside* the returned directory rather than
 * building their own path under `os.tmpdir()`.
 *
 * The whole directory is removed when `fn` settles, so callers never have to unlink
 * individual files.
 *
 * @param prefix - Short label for the directory name; a random suffix is always appended.
 * @param fn - Receives the absolute path of the private temp directory.
 * @returns Whatever `fn` resolves to.
 */
export async function withTempWorkspace<T>(
  prefix: string,
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), `${prefix}-`));
  try {
    return await fn(dir);
  } finally {
    // allow-fallback: temp-workspace cleanup failure is non-fatal and must not mask fn's result
    await rm(dir, { recursive: true, force: true }).catch(() => {
      // intentionally empty
    });
  }
}

import { realpathSync } from 'node:fs';

/**
 * A path that exists, spelled the way the platform's own tools report it.
 *
 * On Windows `realpathSync` keeps an 8.3 short name (`RUNNER~1`) as written while git, and
 * `realpathSync.native`, print the long form. A workspace identity and the host's `canonicalizePath`
 * both answer "where is this directory?" and are compared with each other, so both take their answer
 * from here: a working directory spelled either way then lands on its trusted root. Elsewhere the
 * two forms are the same. Throws, as `realpathSync` does, when the path does not exist.
 */
export function canonicalRealPath(path: string): string {
  return process.platform === 'win32' ? realpathSync.native(path) : realpathSync(path);
}

/**
 * The workspace runs from source with `--conditions=source` (`pnpm cli:dev`, the scenario scripts), and
 * Node applies a condition to every package. `nostr-tools` declares its own `source` condition pointing at
 * `.ts` files its tarball does not ship, so every source run failed on `nostr-tools/pool.ts`. The root
 * `patchedDependencies` entry removes that condition; this loads the subpaths the transport imports the
 * way a source run does.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));

describe('nostr-tools under the source export condition', () => {
  it.each(['nostr-tools/pool', 'nostr-tools/pure'])('loads %s', (specifier) => {
    const result = spawnSync(
      process.execPath,
      ['--conditions=source', '--input-type=module', '-e', `await import('${specifier}');`],
      { cwd: PACKAGE_DIR, encoding: 'utf8' },
    );

    expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(result.status).toBe(0);
  });
});

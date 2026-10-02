/**
 * ARCH-005 S3 — the external-consumer proof.
 *
 * This package is installed from `pnpm pack` tarballs into a directory OUTSIDE the agent runtime monorepo. Every
 * import below resolves to a published package in `node_modules` — there is no workspace link, no path
 * alias, and no relative import into the repo. If an assertion here needs something the published surface
 * does not expose, that is a finding about the surface, not about this file.
 */

import { check, report } from './harness.js';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runModeA } from './mode-a.js';
import { runModeB } from './mode-b.js';
import { runModeC } from './mode-c.js';
import { runModeD } from './mode-d.js';

process.stdout.write(
  'ARCH-005 S3 — external-consumer proof of the published agent runtime product-composition surface\n' +
    `consumer package: ${process.cwd()}\n`,
);

runModeA();
runModeB();
await runModeC();
await runModeD();
const cliHome = mkdtempSync(join(tmpdir(), 'robota-consumer-cli-'));
try {
  for (const flag of ['--version', '--help']) {
    const invocation = spawnSync(
      process.execPath,
      [join(process.cwd(), 'node_modules/.bin/robota'), flag],
      {
        encoding: 'utf8',
        timeout: 30_000,
        env: {
          PATH: process.env.PATH,
          HOME: cliHome,
          USERPROFILE: cliHome,
          PRODUCT_USER_STATE_DIR: join(cliHome, '.robota'),
        },
      },
    );
    check(
      `installed robota ${flag} works without external product identity`,
      invocation.status === 0 && invocation.stdout.trim().length > 0,
      invocation.stderr,
    );
  }
} finally {
  rmSync(cliHome, { recursive: true, force: true });
}
report();

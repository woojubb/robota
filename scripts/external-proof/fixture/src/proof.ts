/**
 * ARCH-005 S3 — the external-consumer proof.
 *
 * This package is installed from `pnpm pack` tarballs into a directory OUTSIDE the Robota monorepo. Every
 * import below resolves to a published package in `node_modules` — there is no workspace link, no path
 * alias, and no relative import into the repo. If an assertion here needs something the published surface
 * does not expose, that is a finding about the surface, not about this file.
 */

import { report } from './harness.js';
import { runModeA } from './mode-a.js';
import { runModeB } from './mode-b.js';
import { runModeC } from './mode-c.js';

process.stdout.write(
  'ARCH-005 S3 — external-consumer proof of the published Robota product-composition surface\n' +
    `consumer package: ${process.cwd()}\n`,
);

runModeA();
runModeB();
await runModeC();
report();

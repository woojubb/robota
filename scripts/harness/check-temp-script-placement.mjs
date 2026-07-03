#!/usr/bin/env node

/**
 * Temp-script placement guard (INFRA-023).
 *
 * Disposable live-verification scripts (backlog User Execution probes) belong in `scratch/src/`
 * (gitignored) — never inside library/app trees. During the 2026-07 goal loop such scripts were
 * repeatedly parked in package roots because of pnpm's script-location-relative ESM resolution;
 * deletion discipline kept them out of commits, but discipline is not a mechanism. This scan is.
 *
 * Findings: a file matching a temp pattern (`*-user-execution.*`, `*-proxy.mjs`, `*-mode.txt`)
 * anywhere under `packages/` or `apps/`.
 *
 * Exit code 0 = no temp scripts parked in product/library trees, 1 = violation found.
 */

import path from 'node:path';
import { globSync } from 'node:fs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

export const TEMP_PATTERNS = ['*-user-execution.*', '*-proxy.mjs', '*-mode.txt'];

/** List temp-pattern files under packages/ and apps/ (node_modules/dist excluded). */
export function findParkedTempScripts(root = WORKSPACE_ROOT) {
  const found = [];
  for (const tier of ['packages', 'apps']) {
    for (const pattern of TEMP_PATTERNS) {
      for (const entry of globSync(`${tier}/**/${pattern}`, { cwd: root })) {
        if (entry.includes('node_modules/') || entry.includes('/dist/')) continue;
        found.push(entry);
      }
    }
  }
  return found.sort();
}

export async function main() {
  const parked = findParkedTempScripts();
  if (parked.length > 0) {
    process.stdout.write(
      'temp-script-placement scan failed — disposable scripts parked in library/app trees:\n',
    );
    for (const file of parked) {
      process.stdout.write(`  - ${file}\n`);
    }
    process.stdout.write(
      'Move live-verification scripts to scratch/src/ (see scratch/README.md).\n',
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write('temp-script-placement scan passed.\n');
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  await main();
}

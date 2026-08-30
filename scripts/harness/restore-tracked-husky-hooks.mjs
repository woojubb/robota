#!/usr/bin/env node

/**
 * Husky recreates `.husky/_` during `prepare`. The repository also tracks the
 * pre-push entrypoint at that path as a fail-closed bootstrap: Git treats a
 * missing `core.hooksPath` as success, which is unsafe in a fresh worktree.
 * Restore the tracked bootstrap after Husky has generated its dispatchers.
 */

import { chmodSync, copyFileSync, existsSync } from 'node:fs';
import path, { resolve } from 'node:path';

export function restoreTrackedHuskyHooks(root) {
  for (const name of ['post-checkout', 'prepare-commit-msg', 'pre-push']) {
    const source = resolve(root, `.husky/_/${name}.fallback`);
    const target = resolve(root, `.husky/_/${name}`);
    if (!existsSync(source)) {
      throw new Error(`tracked Husky fallback is missing: ${source}`);
    }
    copyFileSync(source, target);
    chmodSync(target, 0o755);
  }
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  restoreTrackedHuskyHooks(resolve(import.meta.dirname, '../..'));
}

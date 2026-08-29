#!/usr/bin/env node

/**
 * Husky recreates `.husky/_` during `prepare`. The repository also tracks the
 * pre-push entrypoint at that path as a fail-closed bootstrap: Git treats a
 * missing `core.hooksPath` as success, which is unsafe in a fresh worktree.
 * Restore the tracked bootstrap after Husky has generated its dispatchers.
 */

import { copyFileSync, existsSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const source = resolve(root, '.husky/_/pre-push.fallback');
const target = resolve(root, '.husky/_/pre-push');

if (!existsSync(source)) {
  throw new Error(`tracked Husky fallback is missing: ${source}`);
}

copyFileSync(source, target);
chmodSync(target, 0o755);

/**
 * The single sanctioned temp-directory creator for harness tests (INFRA-126).
 *
 * ## Why this exists
 *
 * The harness test suite exhausted `/tmp`'s INODES and every push from the host began failing with
 * `no space left on device` — on a filesystem with 4.3G free. The error names the wrong resource,
 * which is why the first reading was "the disk is full".
 *
 * Measured at the time: 158 harness test files created temp directories and 85 of them never
 * removed one. One run of a single 42-test file left 41 directories behind — about one per case —
 * and the suite runs on every push via the pre-push contracts tier, in CI, and across several
 * sessions sharing one clone. 58,856 `robota-*` directories had accumulated at the top level.
 *
 * ## Why the creator owns the teardown
 *
 * From outside the process there is NO way to tell an in-flight temp directory from an abandoned
 * one, so reaping by age is a guess at that distinction — it hides the defect and races a concurrent
 * session's directory. The creator is the only thing that knows when it is finished, so creation and
 * removal belong in one place.
 *
 * ## Why a direct `mkdtemp` is refused even when the caller cleans up
 *
 * `temp-dir-owner` refuses any direct `mkdtemp`/`mkdtempSync` under `__tests__`, including in a file
 * that removes what it made. That is deliberate. A teardown-conditional check would have to decide
 * whether a given directory is removed, which it cannot see — "the file contains `rmSync` somewhere"
 * is not "this directory is removed" — and it would pass correct-but-unsanctioned code, teaching
 * nothing about the rule. Making the call site the subject keeps the question textual and exact.
 *
 * ## Usage
 *
 *   import { makeTemp } from './make-temp.mjs';
 *
 *   const dir = makeTemp('robota-my-scan-');   // removed automatically after the file's tests
 *
 * Registration is per test FILE: the first call installs one `afterAll`, and every directory the
 * file makes is removed then. Removal is best-effort — a directory already gone is not an error,
 * because a test that cleans up after itself must not fail the suite for being tidy.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll } from 'vitest';

const created = [];

/**
 * Registered at MODULE LOAD, not on first use.
 *
 * The first cut registered lazily inside `makeTemp`, which looked equivalent and removed nothing:
 * by the time a test calls the helper the suite is already RUNNING, and vitest collects hooks during
 * collection — a hook registered from inside a test body never runs. Measured, and it is the reason
 * this comment exists: after migrating the five worst files the run still left 123 directories
 * behind, all under the migrated prefixes. The helper looked correct and did nothing.
 *
 * Importing this module is what registers the teardown, so every file that uses `makeTemp` gets it.
 */
afterAll(() => {
  while (created.length > 0) {
    // `force` because a test may legitimately remove its own directory early; a tidy test must not
    // fail the suite here.
    rmSync(created.pop(), { recursive: true, force: true });
  }
});

/**
 * Create a temp directory that is removed when this test file finishes.
 *
 * @param {string} prefix - directory-name prefix; keep the `robota-` lead so a leak is attributable.
 * @returns {string} absolute path to the new directory
 */
export function makeTemp(prefix = 'robota-harness-') {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

/** How many directories this file has made and not yet released. Exported for the floor's own test. */
export function pendingTempCount() {
  return created.length;
}

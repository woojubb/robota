/**
 * A receipt for the SCAN SUITE, so an identical tree is not scanned twice (HARNESS-109).
 *
 * ## Why this exists
 *
 * `verification-receipt.mjs` already makes `verify-like-ci` reusable. The suite this file covers is
 * the one that actually repeats: `pre-push` runs it through `CI_SCANS_JOB_MIRROR` on every push, CI
 * runs it again, and an agent runs it by hand whenever it wants a signal. Nothing connected those
 * runs, so scanning one tree three times was indistinguishable, to the harness, from scanning three
 * trees. Measured on 2026-08-19: resolving a three-line JSON conflict ran the full suite twice on
 * trees whose scanned content was identical.
 *
 * ## What the identity covers, and what it deliberately cannot
 *
 * `headTree` is the content of every TRACKED file — every scan script, every baseline, every source
 * file they read — so any change to what the suite reads or how it reads it invalidates the receipt.
 * The toolchain is carried separately because it is not in the tree.
 *
 * What a tree hash cannot cover is a scan that reads build OUTPUT. `dist` and `build-contracts`
 * compare `dist/` against `src/`, and `dist/` is ignored: two runs with one tree hash can legitimately
 * disagree. Those scans are declared here and are simply ALWAYS RE-RUN — they cost milliseconds,
 * because they stat files. Making the whole run ineligible instead (HARNESS-109's first shape) meant
 * a plain `pnpm harness:scan` could never be reused, which is the command the item was filed about.
 *
 * They are also excluded from the receipt's identity, so a full local run and CI's
 * `--skip dist --skip build-contracts` share one receipt: what the receipt asserts is the result of
 * the scans a tree hash CAN speak for, and that set is the same in both.
 *
 * ## The direction this fails in
 *
 * A receipt that is missing, malformed, or written against a different identity re-runs the suite.
 * There is no path where an unreadable receipt is treated as a pass — reuse is an optimisation, and
 * an optimisation that can invent a green is not one.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { isCleanTree, realDirtyLines } from './verification-receipt.mjs';

const RECEIPT_SCHEMA_VERSION = 1;
const RECEIPT_FILE = 'robota-verification/harness-scan.json';

/**
 * Scans whose inputs are NOT in the tree, so a tree hash cannot speak for them. Named, not inferred:
 * a scan added later that reads build output must be added here in the same change, and the test
 * asserting they are re-run on a hit is what makes that visible.
 */
export const TREE_EXTERNAL_SCANS = new Set(['dist', 'build-contracts']);

function run(command, args, root) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr?.trim() ?? ''}`);
  }
  return result.stdout.trim();
}

function hashFile(root, relativePath) {
  try {
    return createHash('sha256')
      .update(readFileSync(path.join(root, relativePath)))
      .digest('hex');
  } catch {
    return 'absent';
  }
}

/** The requested scans a tree hash CAN speak for — the only ones a receipt ever asserts. */
export function receiptCoveredScans(scanNames) {
  return [...scanNames].filter((name) => !TREE_EXTERNAL_SCANS.has(name)).sort();
}

/** The requested scans that must run on every invocation, receipt or not. */
export function scansThatAlwaysRun(scanNames) {
  return [...scanNames].filter((name) => TREE_EXTERNAL_SCANS.has(name)).sort();
}

export function computeScanIdentity({ scanNames, root }) {
  return {
    headTree: run('git', ['rev-parse', 'HEAD^{tree}'], root),
    scans: receiptCoveredScans(scanNames),
    nodeVersion: process.version,
    pnpmVersion: run('pnpm', ['--version'], root),
    lockfileHash: hashFile(root, 'pnpm-lock.yaml'),
  };
}

function normalized(identity) {
  if (!identity || typeof identity !== 'object') return null;
  const scalars = ['headTree', 'nodeVersion', 'pnpmVersion', 'lockfileHash'];
  if (scalars.some((field) => typeof identity[field] !== 'string' || !identity[field])) return null;
  if (!Array.isArray(identity.scans) || identity.scans.some((s) => typeof s !== 'string')) {
    return null;
  }
  return Object.fromEntries([
    ...scalars.map((field) => [field, identity[field]]),
    ['scans', [...identity.scans].sort()],
  ]);
}

export function scanReceiptMatches(receipt, expectedIdentity) {
  if (!receipt || receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION || receipt.status !== 'pass') {
    return false;
  }
  const actual = normalized(receipt.identity);
  const expected = normalized(expectedIdentity);
  return Boolean(actual && expected && JSON.stringify(actual) === JSON.stringify(expected));
}

export function scanReceiptPath(root) {
  const commonDir = run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], root);
  return path.join(commonDir, RECEIPT_FILE);
}

export function readScanReceipt(root) {
  try {
    return JSON.parse(readFileSync(scanReceiptPath(root), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The whole reuse decision as one pure function, so every branch is testable without a repository.
 * Returns the reason in BOTH directions: a run that could not be reused has to say why, or the
 * operator learns the receipt is doing nothing only by watching the clock.
 */
export function decideScanReuse({
  scanNames,
  identity,
  receipt,
  clean,
  dirtyReason,
  writeAdoption = false,
}) {
  if (writeAdoption) {
    // A re-freeze is a request to OBSERVE a pass, not to be told one happened earlier. Reusing here
    // would leave the baseline unwritten and the run looking successful — the caller asked for a
    // side effect, and a cache that swallows a requested side effect is a defect, not a saving.
    return {
      reuse: false,
      eligible: false,
      reason: '--write-adoption-baseline re-freezes from an observed pass',
    };
  }
  if (receiptCoveredScans(scanNames).length === 0) {
    // Nothing a receipt could assert. Reusing here would report a saving over an empty set.
    return { reuse: false, eligible: false, reason: 'no scan in this set is covered by a receipt' };
  }
  if (!clean) {
    return { reuse: false, eligible: false, reason: `working tree is not clean: ${dirtyReason}` };
  }
  if (!receipt) return { reuse: false, eligible: true, reason: 'no receipt for this tree' };
  if (!scanReceiptMatches(receipt, identity)) {
    return { reuse: false, eligible: true, reason: 'receipt does not match this identity' };
  }
  return { reuse: true, eligible: true, reason: `identical tree scanned at ${receipt.scannedAt}` };
}

export function createScanReceipt(identity, scannedAt) {
  const normalizedIdentity = normalized(identity);
  if (!normalizedIdentity)
    throw new Error('Cannot create a scan receipt from an invalid identity.');
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    status: 'pass',
    scannedAt,
    identity: normalizedIdentity,
  };
}

export function writeScanReceipt({ scanNames, root, scannedAt = new Date().toISOString() }) {
  if (receiptCoveredScans(scanNames).length === 0) {
    return { written: false, reason: 'no scan in this set is covered by a receipt' };
  }
  const dirty = realDirtyLines(root);
  if (dirty.length > 0) {
    return { written: false, reason: `working tree is not clean: ${dirty.join(', ')}` };
  }
  const target = scanReceiptPath(root);
  const receipt = createScanReceipt(computeScanIdentity({ scanNames, root }), scannedAt);
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  renameSync(temporary, target);
  return { written: true, target, receipt };
}

/** The read half, wired for a real repository: identity + receipt + cleanliness in one call. */
export function planScanReuse({ scanNames, root, writeAdoption = false }) {
  if (writeAdoption) {
    return decideScanReuse({
      scanNames,
      identity: null,
      receipt: null,
      clean: false,
      writeAdoption,
    });
  }
  const dirty = realDirtyLines(root);
  return decideScanReuse({
    scanNames,
    identity: computeScanIdentity({ scanNames, root }),
    receipt: readScanReceipt(root),
    clean: isCleanTree(root),
    dirtyReason: dirty.join(', '),
  });
}

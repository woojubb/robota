/**
 * HARNESS-109. The decision is a pure function precisely so every branch is reachable here without a
 * repository — including the ones that must NOT reuse, which are the branches that matter: a reuse
 * mechanism can only fail in one dangerous direction, and it is this one.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { isCleanTree, realDirtyLines } from '../verification-receipt.mjs';

import {
  TREE_EXTERNAL_SCANS,
  createScanReceipt,
  decideScanReuse,
  receiptCoveredScans,
  scanReceiptMatches,
  scansThatAlwaysRun,
} from '../scan-receipt.mjs';

const IDENTITY = {
  headTree: 'a'.repeat(40),
  scans: ['consistency', 'file-size'],
  nodeVersion: 'v22.14.0',
  pnpmVersion: '10.0.0',
  lockfileHash: 'b'.repeat(64),
};

const receiptFor = (identity) => createScanReceipt(identity, '2026-08-19T00:00:00.000Z');

const decide = (overrides = {}) =>
  decideScanReuse({
    scanNames: IDENTITY.scans,
    identity: IDENTITY,
    receipt: receiptFor(IDENTITY),
    clean: true,
    ...overrides,
  });

describe('decideScanReuse — the reusing direction', () => {
  it('reuses an identical identity on a clean tree, and names when it was scanned', () => {
    const decision = decide();
    expect(decision.reuse).toBe(true);
    expect(decision.reason).toContain('2026-08-19T00:00:00.000Z');
  });

  it('does not care about the order the scans were listed in', () => {
    expect(decide({ scanNames: ['file-size', 'consistency'] }).reuse).toBe(true);
  });
});

describe('decideScanReuse — every refusing direction', () => {
  it('refuses when the tree content differs', () => {
    const decision = decide({ identity: { ...IDENTITY, headTree: 'c'.repeat(40) } });
    expect(decision.reuse).toBe(false);
    expect(decision.reason).toMatch(/does not match/);
  });

  it('refuses when a different scan set ran', () => {
    const decision = decide({
      scanNames: ['consistency'],
      identity: { ...IDENTITY, scans: ['consistency'] },
    });
    expect(decision.reuse).toBe(false);
  });

  it('refuses on a different toolchain', () => {
    expect(decide({ identity: { ...IDENTITY, nodeVersion: 'v20.0.0' } }).reuse).toBe(false);
    expect(decide({ identity: { ...IDENTITY, pnpmVersion: '9.0.0' } }).reuse).toBe(false);
    expect(decide({ identity: { ...IDENTITY, lockfileHash: 'd'.repeat(64) } }).reuse).toBe(false);
  });

  it('refuses when the working tree is dirty, and says what was dirty', () => {
    const decision = decide({ clean: false, dirtyReason: ' M packages/x/src/a.ts' });
    expect(decision.reuse).toBe(false);
    expect(decision.reason).toContain('packages/x/src/a.ts');
  });

  it('refuses when there is no receipt', () => {
    expect(decide({ receipt: null }).reuse).toBe(false);
  });

  it('refuses a malformed, failed, or wrong-version receipt', () => {
    expect(decide({ receipt: { schemaVersion: 1, status: 'pass' } }).reuse).toBe(false);
    expect(decide({ receipt: { ...receiptFor(IDENTITY), status: 'fail' } }).reuse).toBe(false);
    expect(decide({ receipt: { ...receiptFor(IDENTITY), schemaVersion: 2 } }).reuse).toBe(false);
    expect(decide({ receipt: 'not an object' }).reuse).toBe(false);
  });

  it('refuses a receipt whose identity is missing a field rather than treating absence as equal', () => {
    const receipt = receiptFor(IDENTITY);
    delete receipt.identity.headTree;
    expect(scanReceiptMatches(receipt, IDENTITY)).toBe(false);
  });
});

describe('a requested side effect is never swallowed by the cache', () => {
  it('refuses reuse when --write-adoption-baseline asked for an observed pass', () => {
    // Review finding on #1888: with a receipt hit the run returned early, so the re-freeze the
    // caller explicitly asked for silently did not happen and the output said only "not re-run".
    const decision = decide({ writeAdoption: true });
    expect(decision.reuse).toBe(false);
    expect(decision.reason).toContain('--write-adoption-baseline');
  });

  it('refuses it even on an otherwise perfectly reusable identity', () => {
    expect(decide({ writeAdoption: true, clean: true }).reuse).toBe(false);
    expect(decide({ writeAdoption: false }).reuse).toBe(true);
  });
});

describe('scans whose inputs are not in the tree', () => {
  it('names them, so adding one later is a visible change', () => {
    expect([...TREE_EXTERNAL_SCANS].sort()).toEqual(['build-contracts', 'dist']);
  });

  it('keeps them out of what a receipt asserts, so one receipt serves both call sites', () => {
    // A full local run and CI's `--skip dist --skip build-contracts` differ only by these two, and
    // the receipt never spoke for them — so both must produce the SAME identity, or the command the
    // item was filed about (a plain `pnpm harness:scan`) can never be reused.
    expect(receiptCoveredScans(['consistency', 'dist', 'build-contracts'])).toEqual([
      'consistency',
    ]);
    expect(receiptCoveredScans(['consistency'])).toEqual(['consistency']);
  });

  it('re-runs them on a hit instead of blocking the hit', () => {
    const scans = ['consistency', 'file-size', 'dist'];
    const identity = { ...IDENTITY, scans: receiptCoveredScans(scans) };
    const decision = decideScanReuse({
      scanNames: scans,
      identity,
      receipt: receiptFor(identity),
      clean: true,
    });

    expect(decision.reuse).toBe(true);
    expect(scansThatAlwaysRun(scans)).toEqual(['dist']);
  });

  it('does not claim a saving when the set is nothing but those scans', () => {
    const scans = ['dist', 'build-contracts'];
    const decision = decideScanReuse({
      scanNames: scans,
      identity: null,
      receipt: null,
      clean: true,
    });
    expect(decision.reuse).toBe(false);
    expect(decision.reason).toMatch(/no scan in this set is covered/);
  });
});

describe('createScanReceipt', () => {
  it('refuses to create one from an invalid identity', () => {
    expect(() => createScanReceipt({ headTree: 'a' }, '2026-08-19T00:00:00.000Z')).toThrow();
  });
});

describe('receipt eligibility in a real agent clone (HARNESS-109)', () => {
  /**
   * The hole this closes was not theoretical: an untracked file the agent harness writes into every
   * clone made `isCleanTree()` false for whole sessions, so no receipt was ever written and every
   * push re-ran the full gate. The ignore rule is a CLASS, and this asserts the class matches —
   * without it the assertion would be about git, which is not ours to test.
   */
  it('a per-clone harness config file does not make the tree dirty', () => {
    const root = makeTemp('harness-109-');
    try {
      const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
      git('init', '-q');
      git('config', 'user.email', 'test@example.com');
      git('config', 'user.name', 'test');
      writeFileSync(path.join(root, '.gitignore'), '.claude/*.local.json\n');
      git('add', '.gitignore');
      git('commit', '-qm', 'root');

      expect(isCleanTree(root)).toBe(true);

      mkdirSync(path.join(root, '.claude'), { recursive: true });
      writeFileSync(path.join(root, '.claude', 'settings.local.json'), '{}\n');
      expect(isCleanTree(root)).toBe(true);

      // The exemption is narrow: anything else still makes the tree unclean, so a receipt can never
      // stand behind a tree a human changed.
      writeFileSync(path.join(root, '.claude', 'settings.json'), '{}\n');
      expect(realDirtyLines(root)).toEqual(['?? .claude/settings.json']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

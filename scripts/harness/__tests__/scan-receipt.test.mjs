/**
 * HARNESS-109. The decision is a pure function precisely so every branch is reachable here without a
 * repository — including the ones that must NOT reuse, which are the branches that matter: a reuse
 * mechanism can only fail in one dangerous direction, and it is this one.
 */
import { describe, expect, it } from 'vitest';

import {
  TREE_EXTERNAL_SCANS,
  createScanReceipt,
  decideScanReuse,
  scanReceiptMatches,
  scanSetIsEligible,
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

describe('scans whose inputs are not in the tree', () => {
  it('names them, so adding one later is a visible change', () => {
    expect([...TREE_EXTERNAL_SCANS].sort()).toEqual(['build-contracts', 'dist']);
  });

  it('makes a set containing one ineligible in both directions', () => {
    expect(scanSetIsEligible(['consistency', 'dist'])).toBe(false);
    expect(scanSetIsEligible(['consistency', 'file-size'])).toBe(true);

    const decision = decide({ scanNames: ['consistency', 'dist'] });
    expect(decision.reuse).toBe(false);
    expect(decision.eligible).toBe(false);
    expect(decision.reason).toContain('dist');
  });

  it('refuses the ineligible set even when everything else matches perfectly', () => {
    // The dangerous case: identity, receipt and cleanliness all agree, and reuse must STILL not
    // happen, because `dist/` can differ under one tree hash.
    const scans = ['build-contracts', 'consistency'];
    const identity = { ...IDENTITY, scans };
    expect(
      decideScanReuse({ scanNames: scans, identity, receipt: receiptFor(identity), clean: true })
        .reuse,
    ).toBe(false);
  });
});

describe('createScanReceipt', () => {
  it('refuses to create one from an invalid identity', () => {
    expect(() => createScanReceipt({ headTree: 'a' }, '2026-08-19T00:00:00.000Z')).toThrow();
  });
});

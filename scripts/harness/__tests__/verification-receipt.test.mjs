import { describe, expect, it } from 'vitest';

import {
  createVerificationReceipt,
  pushedObjectsMatchVerifiedHead,
  receiptMatches,
  shouldWriteFullReceipt,
} from '../verification-receipt.mjs';

const identity = {
  headCommit: 'head-a',
  headTree: 'tree-a',
  baseCommit: 'base-a',
  profile: 'verify-like-ci/full',
  stages: ['format-check', 'harness-self-test'],
  nodeVersion: 'v22.14.0',
  pnpmVersion: '8.15.4',
  lockfileHash: 'lock-a',
  ownerFingerprint: 'owners-a',
};

describe('exact verification receipts', () => {
  it('matches only an identical successful full-gate identity', () => {
    const receipt = createVerificationReceipt(identity);
    expect(receiptMatches(receipt, identity)).toBe(true);

    for (const [field, value] of [
      ['headCommit', 'head-b'],
      ['headTree', 'tree-b'],
      ['baseCommit', 'base-b'],
      ['profile', 'pre-push/fast'],
      ['nodeVersion', 'v24.0.0'],
      ['pnpmVersion', '9.0.0'],
      ['lockfileHash', 'lock-b'],
      ['ownerFingerprint', 'owners-b'],
    ]) {
      expect(receiptMatches(receipt, { ...identity, [field]: value }), field).toBe(false);
    }
    expect(receiptMatches(receipt, { ...identity, stages: ['format-check'] })).toBe(false);
  });

  it('treats missing, malformed, partial, failed, and unknown-version receipts as misses', () => {
    expect(receiptMatches(null, identity)).toBe(false);
    expect(receiptMatches({}, identity)).toBe(false);
    expect(
      receiptMatches({ ...createVerificationReceipt(identity), status: 'fail' }, identity),
    ).toBe(false);
    expect(
      receiptMatches({ ...createVerificationReceipt(identity), schemaVersion: 999 }, identity),
    ).toBe(false);
  });

  it('writes evidence only for a complete clean successful stage set', () => {
    const complete = {
      exitCode: 0,
      clean: true,
      selectedStages: ['a', 'b'],
      requiredStages: ['a', 'b'],
    };
    expect(shouldWriteFullReceipt(complete)).toBe(true);
    expect(shouldWriteFullReceipt({ ...complete, clean: false })).toBe(false);
    expect(shouldWriteFullReceipt({ ...complete, exitCode: 1 })).toBe(false);
    expect(shouldWriteFullReceipt({ ...complete, selectedStages: ['a'] })).toBe(false);
  });

  it('reuses evidence only when every non-delete pushed object is the verified HEAD', () => {
    const update = (localObjectId, localRef = 'refs/heads/feature') => ({
      localRef,
      localObjectId,
    });
    expect(pushedObjectsMatchVerifiedHead([update('head-a')], 'head-a')).toBe(true);
    expect(pushedObjectsMatchVerifiedHead([update('head-b')], 'head-a')).toBe(false);
    expect(
      pushedObjectsMatchVerifiedHead(
        [update('head-a'), update('0'.repeat(40), '(delete)')],
        'head-a',
      ),
    ).toBe(true);
  });
});

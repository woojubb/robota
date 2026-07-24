import { describe, expect, it } from 'vitest';

import { evaluateFileSizes } from '../scan-file-size.mjs';

/**
 * HARNESS-DIET-003 — the file-size RATCHET. The scan was warn-only (vacuous) for a year; these tests
 * lock in the enforcing semantics: new violators fail, frozen debt may not grow, shrinking tightens.
 */
describe('scan-file-size ratchet (HARNESS-DIET-003)', () => {
  const MAX = 300;

  it('a NEW file over the limit (not baselined) fails', () => {
    const { findings } = evaluateFileSizes(
      [{ relPath: 'packages/x/src/big.ts', lineCount: 301 }],
      {},
      MAX,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('file-too-large');
  });

  it('a file at or under the limit passes regardless of baseline', () => {
    const { findings } = evaluateFileSizes(
      [
        { relPath: 'packages/x/src/ok.ts', lineCount: 300 },
        { relPath: 'packages/x/src/small.ts', lineCount: 10 },
      ],
      {},
      MAX,
    );
    expect(findings).toHaveLength(0);
  });

  it('a baselined file AT its frozen count passes (debt frozen, not licensed to grow)', () => {
    const { findings } = evaluateFileSizes(
      [{ relPath: 'packages/x/src/legacy.ts', lineCount: 500 }],
      { 'packages/x/src/legacy.ts': 500 },
      MAX,
    );
    expect(findings).toHaveLength(0);
  });

  it('a baselined file that GREW past its frozen count fails', () => {
    const { findings } = evaluateFileSizes(
      [{ relPath: 'packages/x/src/legacy.ts', lineCount: 501 }],
      { 'packages/x/src/legacy.ts': 500 },
      MAX,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('file-grew-past-baseline');
  });

  it('a baselined file that SHRANK is reported as ratchet-tightenable, not a finding', () => {
    const { findings, tightenable } = evaluateFileSizes(
      [{ relPath: 'packages/x/src/legacy.ts', lineCount: 400 }],
      { 'packages/x/src/legacy.ts': 500 },
      MAX,
    );
    expect(findings).toHaveLength(0);
    expect(tightenable).toEqual(['packages/x/src/legacy.ts']);
  });

  it('a baselined file burned down BELOW the limit is tightenable (drop from baseline)', () => {
    const { findings, tightenable } = evaluateFileSizes(
      [{ relPath: 'packages/x/src/legacy.ts', lineCount: 250 }],
      { 'packages/x/src/legacy.ts': 500 },
      MAX,
    );
    expect(findings).toHaveLength(0);
    expect(tightenable).toEqual(['packages/x/src/legacy.ts']);
  });

  it('a deleted baselined file is reported stale', () => {
    const { stale } = evaluateFileSizes([], { 'packages/x/src/gone.ts': 500 }, MAX);
    expect(stale).toEqual(['packages/x/src/gone.ts']);
  });
});

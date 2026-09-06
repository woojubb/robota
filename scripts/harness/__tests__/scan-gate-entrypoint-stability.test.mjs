import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BASELINE_PATH,
  FACADE_PATH,
  evaluateStability,
  sha256,
  stableFacadeShape,
} from '../scan-gate-entrypoint-stability.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const facade = readFileSync(path.join(root, FACADE_PATH), 'utf8');
const baseline = readFileSync(path.join(root, BASELINE_PATH), 'utf8');

describe('gate-entrypoint-stability', () => {
  it('accepts the frozen facade when feature modules change', () => {
    expect(stableFacadeShape(facade)).toBe(true);
    expect(
      evaluateStability({
        facadeText: facade,
        baselineText: baseline,
        changedPaths: ['scripts/harness/gate-operations.mjs'],
        baseHasBaseline: true,
      }),
    ).toEqual([]);
  });

  it('rejects a one-byte facade mutation even when the baseline is unchanged', () => {
    const mutated = `${facade} `;
    expect(
      evaluateStability({
        facadeText: mutated,
        baselineText: baseline,
        changedPaths: [FACADE_PATH],
        baseHasBaseline: true,
      }).join('\n'),
    ).toMatch(/digest differs|frozen after migration/);
  });

  it('rejects a forged baseline instead of allowing it to bless a changed facade', () => {
    const forged = baseline.replace(sha256(facade), sha256(`${facade} `));
    expect(
      evaluateStability({
        facadeText: facade,
        baselineText: forged,
        changedPaths: ['scripts/harness/gate-operations.mjs'],
        baseHasBaseline: true,
      }),
    ).toContain(`${FACADE_PATH} digest differs from the frozen baseline`);
  });

  it('requires the facade and its baseline to be introduced together', () => {
    expect(
      evaluateStability({
        facadeText: facade,
        baselineText: baseline,
        changedPaths: [FACADE_PATH],
        baseHasBaseline: false,
      }).join('\n'),
    ).toContain(
      'introduce scripts/harness/gate.mjs and scripts/harness/gate-entrypoint-baseline.json together',
    );
  });
});

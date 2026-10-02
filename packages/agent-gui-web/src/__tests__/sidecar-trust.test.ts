import { describe, expect, it } from 'vitest';

import {
  shouldAskToTrust,
  sidecarTrustDecision,
  trustQuestionLines,
} from '../../scripts/sidecar-trust.mjs';

/** Issue #3268: `pnpm gui:dev` asks about an untrusted folder at its terminal before the sidecar starts. */
describe('gui:dev sidecar trust question', () => {
  const untrusted = {
    state: 'untrusted',
    workspace: '/work/repo',
    askable: true,
    loads: Array.from({ length: 20 }, (_, index) => `  [absent] source-${index}`),
  };

  it('asks only where a grant could help and someone can answer', () => {
    expect(shouldAskToTrust(untrusted, true)).toBe(true);
    expect(shouldAskToTrust(untrusted, false)).toBe(false);
    expect(shouldAskToTrust({ ...untrusted, state: 'trusted', askable: false }, true)).toBe(false);
    expect(shouldAskToTrust(undefined, true)).toBe(false);
  });

  it('names the folder and what trust would load, capped', () => {
    const lines = trustQuestionLines(untrusted, 'test-product', 12);
    expect(lines[0]).toBe('This folder is not trusted: /work/repo');
    expect(lines).toContain('  [absent] source-11');
    expect(lines).not.toContain('  [absent] source-12');
    expect(lines.at(-1)).toBe('  … 8 more — see test-product trust status');
  });

  it('reads y as trust, r as Restricted, and anything else as quit', () => {
    expect(sidecarTrustDecision('y')).toBe('trust');
    expect(sidecarTrustDecision(' YES ')).toBe('trust');
    expect(sidecarTrustDecision('r')).toBe('restricted');
    expect(sidecarTrustDecision('')).toBe('quit');
    expect(sidecarTrustDecision('n')).toBe('quit');
  });
});

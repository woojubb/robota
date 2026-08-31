import { describe, expect, it } from 'vitest';

import {
  canonicalProductStatePath,
  productSurfaceInvocation,
  tokenizeCanonicalShell,
} from '../user-execution-scenario-surface.mjs';

describe('user-execution scenario surface grammar', () => {
  it('accepts canonical product invocations and rejects shell substitution', () => {
    expect(tokenizeCanonicalShell('`robota --version`')?.tokens).toEqual(['robota', '--version']);
    expect(tokenizeCanonicalShell('robota $(whoami)')).toBeNull();
    expect(productSurfaceInvocation('robota-cli', 'robota --version', null, null)).toBe(
      'robota --version',
    );
    expect(canonicalProductStatePath('.robota/session.json')).toBe('.robota/session.json');
    expect(canonicalProductStatePath('../session.json')).toBeNull();
  });
});

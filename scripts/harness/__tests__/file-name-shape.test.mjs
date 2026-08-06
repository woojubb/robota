import { describe, expect, it } from 'vitest';

import { hasStem } from '../lib/file-name-shape.mjs';

/**
 * Is this token a file NAME, or a shape a file ends with?
 *
 * Two checks needed the same answer and each grew its own. The named-artifact scan learned to tell
 * `.eslintrc.json` from `.test.ts`; the commit-message rule did not — so a message citing `.test.ts`
 * while explaining a convention was refused for naming a file that does not exist. Measured on this
 * repository's own continuous integration, on the commit that shipped the first half of that rule.
 *
 * It is one answer now, and this file is where it is pinned.
 */
describe('a dot-file is a file; a suffix is a shape', () => {
  it('accepts a real dot-file', () => {
    expect(hasStem('.eslintrc.json')).toBe(true);
    expect(hasStem('.env.example')).toBe(true);
    expect(hasStem('.npmrc.example')).toBe(true);
  });

  it('rejects a shape a file ends with', () => {
    // These name no file. Documents explaining a convention mention them constantly, and reading
    // them as names reported every such document.
    expect(hasStem('.d.ts')).toBe(false);
    expect(hasStem('.test.ts')).toBe(false);
    expect(hasStem('.spec.ts')).toBe(false);
    expect(hasStem('.live.test.ts')).toBe(false);
  });

  it('accepts an ordinary name, with or without a directory', () => {
    expect(hasStem('AGENTS.md')).toBe(true);
    expect(hasStem('scan-x.mjs')).toBe(true);
    expect(hasStem('.github/workflows/ci.yml')).toBe(true);
  });

  it('rejects a token with no extension at all', () => {
    expect(hasStem('harness')).toBe(false);
    expect(hasStem('scripts/harness')).toBe(false);
  });

  it('judges the BASENAME, so a directory cannot decide it', () => {
    // `a/.test.ts` is still a suffix; `a/.eslintrc.json` is still a file. A check that looked at the
    // whole token would answer differently depending on how deeply it was cited.
    expect(hasStem('packages/x/.test.ts')).toBe(false);
    expect(hasStem('packages/x/.eslintrc.json')).toBe(true);
  });
});

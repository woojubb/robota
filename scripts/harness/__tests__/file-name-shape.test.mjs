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
    // SINGLE-SEGMENT dotfiles. These returned false — the same silent cap review had just found for
    // the two-dot case, not extended to the one-dot case.
    //
    // The rule needs no new list: the segment is a NAME unless it is an EXTENSION. That list already
    // existed for the other question and now lives beside this one, so the two cannot drift.
    expect(hasStem('.gitignore')).toBe(true);
    expect(hasStem('.npmrc')).toBe(true);
    expect(hasStem('.nvmrc')).toBe(true);
    expect(hasStem('.editorconfig')).toBe(true);
    // A BARE EXTENSION is what a document writes while explaining a convention. Reading these as
    // names is the failure that once produced 1656 findings from 470 documents.
    expect(hasStem('.ts')).toBe(false);
    expect(hasStem('.md')).toBe(false);
    expect(hasStem('.json')).toBe(false);
    expect(hasStem('.mjs')).toBe(false);
    // A one-letter segment names no file, the same floor the two-dot branch keeps.
    expect(hasStem('.a')).toBe(false);
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

describe('a suffix is a suffix however it is written', () => {
  it('is not a NAME when the extension is left off', () => {
    // `.test` and `.config` alone are `.test.ts` with the extension dropped — the same shape, and
    // only the two-dot form was excluded. A document writing "files ending in `.test`" is naming a
    // shape, not a file. Review found the asymmetry.
    expect(hasStem('.test')).toBe(false);
    expect(hasStem('.config')).toBe(false);
    expect(hasStem('.spec')).toBe(false);
  });

  it('is not a NAME when it is capitalised', () => {
    // The sibling branch lowercases before checking `EXTENSIONS`; this one did not, so `.Test.ts`
    // failed the lookup and came out as a genuine dot-file.
    expect(hasStem('.Test.ts')).toBe(false);
    expect(hasStem('.Spec.ts')).toBe(false);
    expect(hasStem('.D.ts')).toBe(false);
  });

  it('still reads a real dot-file as a name', () => {
    // The other direction, so the narrowing above cannot quietly swallow the case this function is
    // FOR: these name files, and a document mentioning them is naming something.
    expect(hasStem('.gitignore')).toBe(true);
    expect(hasStem('.npmrc')).toBe(true);
    expect(hasStem('.eslintrc.json')).toBe(true);
  });
});

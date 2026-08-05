import { describe, expect, it } from 'vitest';

import {
  baselineKey,
  findNamedArtifacts,
  hasAllowedReason,
  hasStem,
  isTemplateSlot,
  judgeAgainstBaseline,
  readBaseline,
  scanNamedArtifacts,
} from '../scan-named-artifact-resolves.mjs';

describe('a name is read from a code span, not from prose', () => {
  it('reads a backticked file name', () => {
    expect(findNamedArtifacts('the `scan-x.mjs` guard').map((f) => f.name)).toEqual(['scan-x.mjs']);
  });

  it('does not read a word that merely ends in an extension', () => {
    // The first version matched over plain prose and reported 1656 names across 470 documents,
    // because `Next.js` is a `.js` name and `*.test.ts` yields `test.ts`. A sentence about a
    // framework became a missing file — a check firing on correct data, which is the shape that
    // gets a check suppressed rather than fixed.
    expect(findNamedArtifacts('we use Next.js for SSR')).toEqual([]);
    expect(findNamedArtifacts('files named *.test.ts are tests')).toEqual([]);
  });

  it('does not read a specimen inside a fence', () => {
    expect(findNamedArtifacts('```\n`imaginary.mjs`\n```\n')).toEqual([]);
  });

  it('does not read a name that belongs to another repository', () => {
    expect(findNamedArtifacts('see https://example.invalid/`other.mjs`')).toEqual([]);
  });
});

describe('what is a name at all', () => {
  it('rejects an extension or a suffix, which names no file', () => {
    // `.d.ts` and `.test.ts` are shapes a file ends WITH. Reading them as names reported every
    // document that explains a convention.
    expect(hasStem('.d.ts')).toBe(false);
    expect(hasStem('.test.ts')).toBe(false);
    expect(hasStem('scan-x.mjs')).toBe(true);
    expect(hasStem('.github/workflows/ci.yml')).toBe(true);
  });

  it('rejects a form standing in for a name nobody has chosen', () => {
    expect(isTemplateSlot('ADR-NNN-short-title.md')).toBe(true);
    expect(isTemplateSlot('packages/<pkg>/docs/SPEC.md')).toBe(true);
    expect(isTemplateSlot('AGENTS.md')).toBe(false);
  });
});

describe('the exemption, and where it must sit', () => {
  it('excuses a line that says why the file should not exist', () => {
    expect(hasAllowedReason('names `gone.yml` (allow-missing-artifact: deleted by X)')).toBe(true);
  });

  it('refuses an exemption with no reason in it', () => {
    expect(hasAllowedReason('names `gone.yml` (allow-missing-artifact: )')).toBe(false);
  });

  it('applies to the LINE, so a marker beside the claim is not a marker on it', () => {
    // Measured while writing this: four markers were placed on the line ABOVE the claim and had no
    // effect at all — the names were frozen into the baseline instead of exempted, and the run that
    // "confirmed" the fix had exited early for an unrelated reason. Verify the diff, not the intent.
    const above = 'allow-missing-artifact: it is gone\nthe `imaginary-artifact.mjs` guard';

    expect(findNamedArtifacts(above).map((f) => f.name)).toEqual(['imaginary-artifact.mjs']);
  });
});

describe('the ratchet', () => {
  const finding = { file: 'a.md', name: 'b.mjs' };

  it('lets a frozen name through and stops a new one', () => {
    const frozen = new Set([baselineKey(finding)]);

    expect(judgeAgainstBaseline([finding], frozen).unfrozen).toEqual([]);
    expect(
      judgeAgainstBaseline([finding, { file: 'a.md', name: 'c.mjs' }], frozen).unfrozen,
    ).toHaveLength(1);
  });

  it('reports a baseline entry that no longer occurs, so a fix cannot be spent twice', () => {
    const frozen = new Set([baselineKey(finding), 'gone.md -> gone.mjs']);

    expect(judgeAgainstBaseline([finding], frozen).stale).toEqual(['gone.md -> gone.mjs']);
  });

  it('keys on the PAIR, because the same illustrative name is fine elsewhere and not here', () => {
    expect(baselineKey({ file: 'a.md', name: 'x.mjs' })).not.toBe(
      baselineKey({ file: 'b.md', name: 'x.mjs' }),
    );
  });
});

describe('over the tree it governs', () => {
  it('finds every named artifact either resolving or frozen', () => {
    const { findings, examined } = scanNamedArtifacts();
    const frozen = readBaseline();

    console.log(`::examined:: ${examined} governed documents`);
    expect(frozen, 'the baseline is missing').not.toBeNull();

    const { unfrozen, stale } = judgeAgainstBaseline(findings, frozen);
    expect(unfrozen, JSON.stringify(unfrozen, null, 2)).toEqual([]);
    expect(stale, `stale baseline entries: ${stale.join(', ')}`).toEqual([]);
    // Fail closed: a sweep that examined nothing would satisfy both assertions vacuously.
    expect(examined).toBeGreaterThan(0);
  });
});

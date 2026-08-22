import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { findArchitectureMapPathFindings } from '../check-architecture-map-paths.mjs';
import { findGhostPackageRefFindings } from '../check-ghost-package-refs.mjs';
import { findSpecPathFindings } from '../check-spec-paths.mjs';
import {
  ABSENCE_VOCABULARY,
  PLANNED_ONLY_VOCABULARY,
  citedRepoPaths,
  REPO_SOURCE_PATH_PATTERN,
} from '../cited-paths.mjs';

/**
 * HARNESS-062. Five scans each implemented "a path cited in prose must exist", with forked patterns
 * and forked exemption vocabularies. Measured on ONE sentence placed in an architecture-map doc and
 * in a package SPEC, they returned three different verdicts:
 *
 *   arch-map-paths : 0 findings   ('relocated' was in its wide NEGATION set)
 *   ghost-pkg-refs : 1 finding    ('relocated' was not in its narrow ABSENCE_VOCAB)
 *   spec-paths     : 1 finding    (only '(planned)' was exempt)
 *
 * A rule with three implementations is three rules. These tests pin the single verdict.
 */
const DISAGREEMENT_SENTENCE = 'The loader was relocated; packages/ghost-pkg/src/loader.ts is gone.';

const MAP_DOC = '.agents/specs/architecture-map/pkg-map.md';
const SPEC_DOC = 'packages/pkg-a/docs/SPEC.md';

async function createFixture(files) {
  const root = makeTemp('robota-cited-paths-');
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

function fixtureFiles() {
  return {
    [MAP_DOC]: `# Map\n\n${DISAGREEMENT_SENTENCE}\n`,
    [SPEC_DOC]: `# SPEC\n\n${DISAGREEMENT_SENTENCE}\n`,
    'packages/pkg-a/package.json': JSON.stringify({ name: '@robota-sdk/pkg-a' }),
  };
}

describe('one sentence, one verdict', () => {
  it('is flagged by the architecture-map scan — "relocated" is not an exemption', async () => {
    const root = await createFixture(fixtureFiles());
    const findings = await findArchitectureMapPathFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain('packages/ghost-pkg/src/loader.ts');
  });

  it('is flagged by the spec-paths scan', async () => {
    const root = await createFixture(fixtureFiles());
    const findings = await findSpecPathFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain('packages/ghost-pkg/src/loader.ts');
  });

  it('is flagged by the ghost-package-refs scan', async () => {
    const root = await createFixture(fixtureFiles());
    const findings = await findGhostPackageRefFindings(root);
    expect(findings.filter((finding) => finding.type === 'ghost-package-path')).toHaveLength(1);
  });
});

describe('citedRepoPaths', () => {
  it('extracts the repo-rooted source paths cited on a line', () => {
    expect(citedRepoPaths(DISAGREEMENT_SENTENCE)).toEqual(['packages/ghost-pkg/src/loader.ts']);
  });

  it('returns nothing when the line explicitly annotates the absence', () => {
    expect(citedRepoPaths('- `packages/a/src/gone.ts` (removed)')).toEqual([]);
  });

  it('does NOT treat narrative past tense as an annotation', () => {
    for (const line of [
      'The module was relocated: packages/a/src/gone.ts',
      'This is stale: packages/a/src/gone.ts',
      'Everything migrated away from packages/a/src/gone.ts',
    ]) {
      expect(citedRepoPaths(line)).toEqual(['packages/a/src/gone.ts']);
    }
  });

  it('honours the strict planned-only vocabulary as a NAMED option', () => {
    const line = '- `packages/a/src/gone.ts` (removed)';
    expect(citedRepoPaths(line, { vocabulary: ABSENCE_VOCABULARY })).toEqual([]);
    expect(citedRepoPaths(line, { vocabulary: PLANNED_ONLY_VOCABULARY })).toEqual([
      'packages/a/src/gone.ts',
    ]);
    expect(
      citedRepoPaths('- `packages/a/src/soon.ts` (planned)', {
        vocabulary: PLANNED_ONLY_VOCABULARY,
      }),
    ).toEqual([]);
  });

  it('drops glob and parent-relative tokens', () => {
    expect(citedRepoPaths('packages/a/src/../b/src/x.ts')).toEqual([]);
  });

  it('exports the source-path pattern as a single owner', () => {
    expect(REPO_SOURCE_PATH_PATTERN.flags).toContain('g');
  });
});

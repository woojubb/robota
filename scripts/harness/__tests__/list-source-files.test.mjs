import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { findDeprecatedMarkerFindings } from '../scan-deprecated-markers.mjs';
import { findFakeInSrc } from '../scan-no-fake-in-src.mjs';
import { findStubMarkerFindings } from '../check-stub-markers.mjs';
import { listSourceFiles } from '../workspace-packages.mjs';

/**
 * HARNESS-062. Twenty-eight hand-rolled tree walkers carried six different exclusion sets, so the
 * same file was source to some scans and invisible to others. Measured: a file at
 * `packages/pub/src/dist/legacy.ts` carrying `@deprecated`, `TODO: Implement` and
 * `export class FakeThing` was opened by `stub-markers` and `deprecated-markers` and never opened at
 * all by `no-fake-in-src`, whose walker skipped any directory named `dist`.
 */
async function createFixture(files) {
  const root = makeTemp('robota-list-source-files-');
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

const LOADED_FILE = [
  '/** @deprecated use the new one */',
  '// TODO: Implement the real path',
  'export class FakeThing {}',
  '',
].join('\n');

describe('one exclusion set across the source-walking scans', () => {
  it('agrees that a build-output directory under src/ is not source', async () => {
    const root = await createFixture({
      'packages/pub/package.json': JSON.stringify({ name: '@robota-sdk/pub' }),
      'packages/pub/src/index.ts': 'export const ok = 1;\n',
      'packages/pub/src/dist/legacy.ts': LOADED_FILE,
    });

    expect(await findStubMarkerFindings(root)).toEqual([]);
    expect(findDeprecatedMarkerFindings(root)).toEqual([]);
    expect(findFakeInSrc(root)).toEqual([]);
  });

  it('agrees that a real source file IS source', async () => {
    const root = await createFixture({
      'packages/pub/package.json': JSON.stringify({ name: '@robota-sdk/pub' }),
      'packages/pub/src/legacy.ts': LOADED_FILE,
    });

    expect(await findStubMarkerFindings(root)).toHaveLength(1);
    expect(findDeprecatedMarkerFindings(root)).toHaveLength(1);
    expect(findFakeInSrc(root)).toHaveLength(1);
  });
});

describe('listSourceFiles', () => {
  async function walkFixture() {
    return createFixture({
      'pkg/src/index.ts': 'export const a = 1;\n',
      'pkg/src/widget.tsx': 'export const b = 2;\n',
      'pkg/src/notes.md': '# not source\n',
      'pkg/src/index.test.ts': 'test\n',
      'pkg/src/index.spec.ts': 'test\n',
      'pkg/src/__tests__/deep.ts': 'test\n',
      'pkg/src/dist/built.ts': 'built\n',
      'pkg/src/coverage/report.ts': 'coverage\n',
      'pkg/src/node_modules/dep/index.ts': 'dep\n',
    });
  }

  function relativeNames(root, files) {
    return files.map((file) => path.relative(root, file).split(path.sep).join('/')).sort();
  }

  it('excludes dependency and build directories, tests, and non-source extensions', async () => {
    const root = await walkFixture();
    expect(relativeNames(root, listSourceFiles(path.join(root, 'pkg/src')))).toEqual([
      'pkg/src/index.ts',
      'pkg/src/widget.tsx',
    ]);
  });

  /**
   * `check-interface-imports` deliberately descends into `__tests__` while the marker scans it
   * mirrors do not — an import-layering violation in a test file is still a violation. That
   * divergence survives as a NAMED option, not as a sixth private walker.
   */
  it('descends into test files when excludeTests is false', async () => {
    const root = await walkFixture();
    expect(
      relativeNames(
        root,
        listSourceFiles(path.join(root, 'pkg/src'), {
          excludeTests: false,
        }),
      ),
    ).toEqual([
      'pkg/src/__tests__/deep.ts',
      'pkg/src/index.spec.ts',
      'pkg/src/index.test.ts',
      'pkg/src/index.ts',
      'pkg/src/widget.tsx',
    ]);
  });

  it('narrows to the requested extensions', async () => {
    const root = await walkFixture();
    expect(
      relativeNames(
        root,
        listSourceFiles(path.join(root, 'pkg/src'), {
          extensions: ['.tsx'],
        }),
      ),
    ).toEqual(['pkg/src/widget.tsx']);
  });

  it('returns nothing for a directory that does not exist', async () => {
    const root = await walkFixture();
    expect(listSourceFiles(path.join(root, 'pkg/absent'))).toEqual([]);
  });
});

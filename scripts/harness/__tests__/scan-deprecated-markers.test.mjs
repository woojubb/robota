import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { findDeprecatedMarkerFindings } from '../scan-deprecated-markers.mjs';

const SCAN_SCRIPT = fileURLToPath(new URL('../scan-deprecated-markers.mjs', import.meta.url));
const WORKSPACE_PACKAGES_HELPER = fileURLToPath(
  new URL('../workspace-packages.mjs', import.meta.url),
);

const DEPRECATED_SOURCE = '/**\n * @deprecated use newThing instead\n */\nexport const x = 1;\n';

async function createFixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-deprecated-markers-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

function pkg(name, priv = false) {
  return JSON.stringify({ name, ...(priv ? { private: true } : {}) });
}

describe('findDeprecatedMarkerFindings', () => {
  it('passes clean publishable package sources', async () => {
    const root = await createFixture({
      'packages/pkg-a/package.json': pkg('@fixture/pkg-a'),
      'packages/pkg-a/src/index.ts': 'export const x = 1;\n',
    });
    expect(findDeprecatedMarkerFindings(root)).toEqual([]);
  });

  it('flags @deprecated in publishable package source (RED)', async () => {
    const root = await createFixture({
      'packages/pkg-a/package.json': pkg('@fixture/pkg-a'),
      'packages/pkg-a/src/index.ts': DEPRECATED_SOURCE,
    });

    expect(findDeprecatedMarkerFindings(root)).toEqual([
      { file: 'packages/pkg-a/src/index.ts', line: 2 },
    ]);
  });

  it('flags @deprecated inside a nested package group member (RED, nesting-aware)', async () => {
    const root = await createFixture({
      'packages/grp/pkg-b/package.json': pkg('@fixture/pkg-b'),
      'packages/grp/pkg-b/src/index.ts': DEPRECATED_SOURCE,
    });

    expect(findDeprecatedMarkerFindings(root)).toEqual([
      { file: 'packages/grp/pkg-b/src/index.ts', line: 2 },
    ]);
  });

  it('skips private packages', async () => {
    const root = await createFixture({
      'packages/priv/package.json': pkg('@fixture/priv', true),
      'packages/priv/src/index.ts': DEPRECATED_SOURCE,
    });
    expect(findDeprecatedMarkerFindings(root)).toEqual([]);
  });

  it('skips test files and __tests__ directories', async () => {
    const root = await createFixture({
      'packages/pkg-a/package.json': pkg('@fixture/pkg-a'),
      'packages/pkg-a/src/index.test.ts': DEPRECATED_SOURCE,
      'packages/pkg-a/src/__tests__/helper.ts': DEPRECATED_SOURCE,
    });
    expect(findDeprecatedMarkerFindings(root)).toEqual([]);
  });

  it('ignores non-source file extensions', async () => {
    const root = await createFixture({
      'packages/pkg-a/package.json': pkg('@fixture/pkg-a'),
      'packages/pkg-a/src/README.md': '@deprecated is discussed here\n',
    });
    expect(findDeprecatedMarkerFindings(root)).toEqual([]);
  });
});

describe('scan-deprecated-markers CLI', () => {
  // The scan anchors its default root at `<script dir>/../..`, so the CLI is exercised by copying
  // the (unmodified) script + its workspace-packages helper into the fixture's scripts/harness/.
  async function createCliFixture(files) {
    const root = await createFixture(files);
    const harnessDir = path.join(root, 'scripts/harness');
    mkdirSync(harnessDir, { recursive: true });
    copyFileSync(SCAN_SCRIPT, path.join(harnessDir, 'scan-deprecated-markers.mjs'));
    copyFileSync(WORKSPACE_PACKAGES_HELPER, path.join(harnessDir, 'workspace-packages.mjs'));
    return { root, scriptCopy: path.join(harnessDir, 'scan-deprecated-markers.mjs') };
  }

  function runScan(scriptCopy, cwd) {
    try {
      const stdout = execFileSync(process.execPath, [scriptCopy], { cwd, encoding: 'utf8' });
      return { status: 0, stdout };
    } catch (error) {
      return { status: error.status, stdout: `${error.stdout ?? ''}` };
    }
  }

  it('exits 0 with a pass message on a clean fixture', async () => {
    const { root, scriptCopy } = await createCliFixture({
      'packages/pkg-a/package.json': pkg('@fixture/pkg-a'),
      'packages/pkg-a/src/index.ts': 'export const x = 1;\n',
    });

    const result = runScan(scriptCopy, root);
    expect(result.stdout).toContain('deprecated marker scan passed.');
    expect(result.status).toBe(0);
  });

  it('exits 1 and lists findings on a deprecated-marker fixture (RED)', async () => {
    const { root, scriptCopy } = await createCliFixture({
      'packages/pkg-a/package.json': pkg('@fixture/pkg-a'),
      'packages/pkg-a/src/index.ts': DEPRECATED_SOURCE,
    });

    const result = runScan(scriptCopy, root);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('deprecated marker scan failed:');
    expect(result.stdout).toContain('packages/pkg-a/src/index.ts:2 contains "@deprecated"');
  });
});

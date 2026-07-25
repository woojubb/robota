import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { findArchitectureMapPathFindings } from '../check-architecture-map-paths.mjs';

const SCAN_SCRIPT = fileURLToPath(new URL('../check-architecture-map-paths.mjs', import.meta.url));

const MAP_DOC = '.agents/specs/architecture-map/pkg-map.md';
const REAL_SOURCE = 'packages/pkg-a/src/index.ts';

async function createFixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-arch-map-paths-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

describe('findArchitectureMapPathFindings', () => {
  it('passes when every cited source path exists', async () => {
    const root = await createFixture({
      [MAP_DOC]: `# Map\n\nEntry point: \`${REAL_SOURCE}\`.\n`,
      [REAL_SOURCE]: 'export {};\n',
    });

    expect(await findArchitectureMapPathFindings(root)).toEqual([]);
  });

  it('flags a cited path that does not exist (RED)', async () => {
    const root = await createFixture({
      [MAP_DOC]: '# Map\n\nEntry point: `packages/pkg-a/src/ghost.ts`.\n',
    });

    const findings = await findArchitectureMapPathFindings(root);
    expect(findings).toEqual([
      {
        file: MAP_DOC,
        type: 'arch-map-ghost-path',
        detail: 'packages/pkg-a/src/ghost.ts is cited but does not exist in the repository.',
      },
    ]);
  });

  it('exempts lines that document a removal on purpose', async () => {
    const root = await createFixture({
      [MAP_DOC]: '# Map\n\n`packages/pkg-a/src/old.ts` was removed in the transport split.\n',
    });

    expect(await findArchitectureMapPathFindings(root)).toEqual([]);
  });

  it('skips the historical audit/lesson logs entirely', async () => {
    const root = await createFixture({
      '.agents/specs/architecture-map/layering-audit.md':
        '# Audit\n\n`packages/pkg-a/src/pre-refactor.ts` cited historically.\n',
      '.agents/specs/architecture-map/architecture-lessons.md':
        '# Lessons\n\n`packages/pkg-a/src/pre-refactor.ts` cited historically.\n',
    });

    expect(await findArchitectureMapPathFindings(root)).toEqual([]);
  });
});

describe('check-architecture-map-paths CLI', () => {
  // The scan anchors its default root at `<script dir>/../..`, so the CLI is exercised by copying
  // the (unmodified) script into the fixture's scripts/harness/ and running that copy.
  async function createCliFixture(files) {
    const root = await createFixture(files);
    const scriptCopy = path.join(root, 'scripts/harness/check-architecture-map-paths.mjs');
    mkdirSync(path.dirname(scriptCopy), { recursive: true });
    copyFileSync(SCAN_SCRIPT, scriptCopy);
    return { root, scriptCopy };
  }

  function runScan(scriptCopy, cwd) {
    try {
      const stdout = execFileSync(process.execPath, [scriptCopy], { cwd, encoding: 'utf8' });
      return { status: 0, stdout };
    } catch (error) {
      return { status: error.status, stdout: `${error.stdout ?? ''}` };
    }
  }

  it('exits 0 with a pass message on a green fixture', async () => {
    const { root, scriptCopy } = await createCliFixture({
      [MAP_DOC]: `# Map\n\nEntry point: \`${REAL_SOURCE}\`.\n`,
      [REAL_SOURCE]: 'export {};\n',
    });

    const result = runScan(scriptCopy, root);
    expect(result.stdout).toContain('architecture-map path scan passed.');
    expect(result.status).toBe(0);
  });

  it('exits 1 and lists ghost paths on a violating fixture (RED)', async () => {
    const { root, scriptCopy } = await createCliFixture({
      [MAP_DOC]: '# Map\n\nEntry point: `packages/pkg-a/src/ghost.ts`.\n',
    });

    const result = runScan(scriptCopy, root);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('architecture-map path scan failed:');
    expect(result.stdout).toContain('[arch-map-ghost-path]');
  });
});

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

async function loadTierOwner() {
  return import('../harness-test-tiers.mjs');
}

describe('harness test tiers', () => {
  it('does not forward hook git context across the Vitest subprocess boundary', async () => {
    const { vitestInvocation } = await loadTierOwner();
    const fixtureRoot = makeTemp('robota-harness-tier-environment-');
    const capturePath = path.join(fixtureRoot, 'environment.json');
    let childLeftoverPath;
    const previousEnvironment = {
      GIT_DIR: process.env.GIT_DIR,
      GIT_INDEX_FILE: process.env.GIT_INDEX_FILE,
      GIT_WORK_TREE: process.env.GIT_WORK_TREE,
      HARNESS_ENV_CAPTURE_PATH: process.env.HARNESS_ENV_CAPTURE_PATH,
    };

    try {
      mkdirSync(path.join(fixtureRoot, 'node_modules', 'vitest'), { recursive: true });
      writeFileSync(path.join(fixtureRoot, 'package.json'), '{"type":"module"}\n');
      writeFileSync(
        path.join(fixtureRoot, 'node_modules', 'vitest', 'vitest.mjs'),
        [
          "import { mkdirSync, writeFileSync } from 'node:fs';",
          "import { tmpdir } from 'node:os';",
          "import path from 'node:path';",
          'const tempDir = tmpdir();',
          "const leftoverPath = path.join(tempDir, 'robota-harness-child-leftover-' + process.pid);",
          'mkdirSync(leftoverPath);',
          'writeFileSync(process.env.HARNESS_ENV_CAPTURE_PATH, JSON.stringify({',
          '  gitDir: process.env.GIT_DIR,',
          '  gitIndexFile: process.env.GIT_INDEX_FILE,',
          '  gitWorkTree: process.env.GIT_WORK_TREE,',
          '  tempDir,',
          '  tempEnvironment: { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP },',
          '  leftoverPath,',
          '}));',
        ].join('\n'),
      );
      process.env.GIT_DIR = '/outer/.git';
      process.env.GIT_INDEX_FILE = '/outer/.git/index';
      process.env.GIT_WORK_TREE = '/outer';
      process.env.HARNESS_ENV_CAPTURE_PATH = capturePath;

      const result = vitestInvocation(fixtureRoot, ['fixture.test.mjs']);

      expect(result.status).toBe(0);
      const captured = JSON.parse(readFileSync(capturePath, 'utf8'));
      childLeftoverPath = captured.leftoverPath;
      expect({
        gitDir: captured.gitDir,
        gitIndexFile: captured.gitIndexFile,
        gitWorkTree: captured.gitWorkTree,
      }).toEqual({});
      expect(path.basename(captured.tempDir)).toMatch(/^robota-harness-suite-/);
      expect(new Set(Object.values(captured.tempEnvironment))).toEqual(new Set([captured.tempDir]));
      expect(existsSync(captured.tempDir)).toBe(false);
      expect(existsSync(captured.leftoverPath)).toBe(false);
    } finally {
      for (const [name, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      if (childLeftoverPath) rmSync(childLeftoverPath, { recursive: true, force: true });
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('strips hook-inherited git context before launching fixture tests', async () => {
    const { harnessTestEnvironment } = await loadTierOwner();
    const environment = harnessTestEnvironment(
      {
        PATH: '/fixture/bin',
        TMPDIR: '/outer/tmpdir',
        TMP: '/outer/tmp',
        TEMP: '/outer/temp',
        GIT_DIR: '/outer/.git',
        GIT_INDEX_FILE: '/outer/.git/index',
        GIT_WORK_TREE: '/outer',
      },
      '/owned/suite-root',
    );

    expect(environment.PATH).toBe('/fixture/bin');
    expect({
      TMPDIR: environment.TMPDIR,
      TMP: environment.TMP,
      TEMP: environment.TEMP,
    }).toEqual({
      TMPDIR: '/owned/suite-root',
      TMP: '/owned/suite-root',
      TEMP: '/owned/suite-root',
    });
    expect(environment.GIT_DIR).toBeUndefined();
    expect(environment.GIT_INDEX_FILE).toBeUndefined();
    expect(environment.GIT_WORK_TREE).toBeUndefined();
  });

  it('partitions the complete harness test directory without overlap', async () => {
    const { classifyHarnessTestFiles } = await loadTierOwner();
    const tiers = classifyHarnessTestFiles(REPO_ROOT);
    expect(tiers.contract.length).toBeGreaterThan(0);
    expect(tiers.hermetic.length).toBeGreaterThan(0);
    expect(new Set([...tiers.contract, ...tiers.hermetic]).size).toBe(
      tiers.contract.length + tiers.hermetic.length,
    );
    expect([...tiers.contract, ...tiers.hermetic].sort()).toEqual(tiers.all);
  });

  it('defaults every unlisted test to the repository-contract tier', async () => {
    const { HERMETIC_TEST_FILES, classifyHarnessTestFiles } = await loadTierOwner();
    const tiers = classifyHarnessTestFiles(REPO_ROOT);
    const unlisted = 'scripts/harness/__tests__/classify-changed-paths.test.mjs';
    expect(HERMETIC_TEST_FILES).not.toContain(unlisted);
    expect(tiers.contract).toContain(unlisted);
  });

  it('declares only files that exist', async () => {
    const { HERMETIC_TEST_FILES } = await loadTierOwner();
    for (const file of HERMETIC_TEST_FILES) {
      expect(existsSync(path.join(REPO_ROOT, file)), file).toBe(true);
    }
  });

  it('exposes explicit root commands for both tiers while the full command keeps both', () => {
    const scripts = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).scripts;
    expect(scripts['harness:test:contracts']).toContain('--tier contracts');
    expect(scripts['harness:test:contracts']).not.toContain('--verify-hermetic-stripped');
    expect(scripts['harness:test:hermetic']).toContain('--verify-hermetic-stripped');
    expect(scripts['harness:test']).toContain('--tier all');
    expect(scripts['harness:test']).toContain('--verify-hermetic-stripped');
    expect(scripts['harness:test:tiers:guard']).toContain('--verify-hermetic-stripped');
  });
});

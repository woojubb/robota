import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

async function loadTierOwner() {
  return import('../harness-test-tiers.mjs');
}

describe('harness test tiers', () => {
  it('strips hook-inherited git context before launching fixture tests', async () => {
    const { harnessTestEnvironment } = await loadTierOwner();
    const environment = harnessTestEnvironment({
      PATH: '/fixture/bin',
      GIT_DIR: '/outer/.git',
      GIT_INDEX_FILE: '/outer/.git/index',
      GIT_WORK_TREE: '/outer',
    });

    expect(environment.PATH).toBe('/fixture/bin');
    expect(environment.TMPDIR).toBeTruthy();
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

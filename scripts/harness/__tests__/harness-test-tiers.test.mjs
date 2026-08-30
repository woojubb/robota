import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';
import * as tierOwner from '../harness-test-tiers.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

describe('harness test tiers', () => {
  it('does not forward hook git context across the Vitest subprocess boundary', async () => {
    const { vitestInvocation } = tierOwner;
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
          '  arguments: process.argv.slice(2),',
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
      expect(captured.arguments).toContain('--maxWorkers=2');
      expect(captured.arguments).not.toContain('--fileParallelism=false');
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
    const { harnessTestEnvironment } = tierOwner;
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

  it('runs every requested file once while file-owned temp cleanup overlaps safely', async () => {
    const { vitestInvocation } = tierOwner;
    const fixtureRoot = makeTemp('robota-harness-tier-parallel-');
    const probeRoot = path.join(fixtureRoot, 'probe');
    mkdirSync(probeRoot);
    writeFileSync(path.join(fixtureRoot, 'package.json'), '{"type":"module"}\n');
    symlinkSync(
      path.join(REPO_ROOT, 'node_modules'),
      path.join(fixtureRoot, 'node_modules'),
      'dir',
    );
    cpSync(
      path.join(REPO_ROOT, 'scripts/harness/__tests__/make-temp.mjs'),
      path.join(fixtureRoot, 'make-temp.mjs'),
    );

    const common = [
      "import { existsSync, readFileSync, writeFileSync } from 'node:fs';",
      "import { tmpdir } from 'node:os';",
      "import path from 'node:path';",
      "import { expect, it } from 'vitest';",
      "import { makeTemp } from './make-temp.mjs';",
      'const waitFor = (predicate, description) => {',
      '  const deadline = Date.now() + 5_000;',
      '  while (!predicate()) {',
      '    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${description}`);',
      '    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);',
      '  }',
      '};',
      'const probeRoot = process.env.HARNESS_PARALLEL_PROBE_ROOT;',
    ];
    writeFileSync(
      path.join(fixtureRoot, 'parallel-a.test.mjs'),
      [
        ...common,
        "const owned = makeTemp('robota-parallel-a-');",
        "writeFileSync(path.join(probeRoot, 'executed-a'), 'a', { flag: 'wx' });",
        "writeFileSync(path.join(tmpdir(), 'owned-a'), owned);",
        "writeFileSync(path.join(tmpdir(), 'ready-a'), 'ready');",
        "it('finishes before file B inspects cleanup', () => {",
        "  waitFor(() => existsSync(path.join(tmpdir(), 'ready-b')), 'file B to start');",
        '  expect(existsSync(owned)).toBe(true);',
        "  writeFileSync(path.join(tmpdir(), 'done-a'), 'done');",
        '});',
      ].join('\n'),
    );
    writeFileSync(
      path.join(fixtureRoot, 'parallel-b.test.mjs'),
      [
        ...common,
        "const owned = makeTemp('robota-parallel-b-');",
        "writeFileSync(path.join(probeRoot, 'executed-b'), 'b', { flag: 'wx' });",
        "writeFileSync(path.join(tmpdir(), 'ready-b'), 'ready');",
        "it('keeps its own temp directory after file A is cleaned', () => {",
        "  waitFor(() => existsSync(path.join(tmpdir(), 'done-a')), 'file A to finish');",
        "  const ownedByA = readFileSync(path.join(tmpdir(), 'owned-a'), 'utf8');",
        "  waitFor(() => !existsSync(ownedByA), 'file A cleanup');",
        '  expect(existsSync(owned)).toBe(true);',
        "  writeFileSync(path.join(probeRoot, 'cleanup-isolated'), 'yes');",
        '});',
      ].join('\n'),
    );

    const previousProbeRoot = process.env.HARNESS_PARALLEL_PROBE_ROOT;
    process.env.HARNESS_PARALLEL_PROBE_ROOT = probeRoot;
    try {
      const result = vitestInvocation(fixtureRoot, ['parallel-a.test.mjs', 'parallel-b.test.mjs']);
      expect(result.status, `${result.stdout ?? ''}${result.stderr ?? ''}`).toBe(0);
      expect(readFileSync(path.join(probeRoot, 'executed-a'), 'utf8')).toBe('a');
      expect(readFileSync(path.join(probeRoot, 'executed-b'), 'utf8')).toBe('b');
      expect(readFileSync(path.join(probeRoot, 'cleanup-isolated'), 'utf8')).toBe('yes');
    } finally {
      if (previousProbeRoot === undefined) delete process.env.HARNESS_PARALLEL_PROBE_ROOT;
      else process.env.HARNESS_PARALLEL_PROBE_ROOT = previousProbeRoot;
    }
  });

  it('partitions the complete harness test directory without overlap', async () => {
    const { classifyHarnessTestFiles } = tierOwner;
    const tiers = classifyHarnessTestFiles(REPO_ROOT);
    expect(tiers.contract.length).toBeGreaterThan(0);
    expect(tiers.hermetic.length).toBeGreaterThan(0);
    expect(new Set([...tiers.contract, ...tiers.hermetic]).size).toBe(
      tiers.contract.length + tiers.hermetic.length,
    );
    expect([...tiers.contract, ...tiers.hermetic].sort()).toEqual(tiers.all);
  });

  it('defaults every unlisted test to the repository-contract tier', async () => {
    const { HERMETIC_TEST_FILES, classifyHarnessTestFiles } = tierOwner;
    const tiers = classifyHarnessTestFiles(REPO_ROOT);
    const unlisted = 'scripts/harness/__tests__/classify-changed-paths.test.mjs';
    expect(HERMETIC_TEST_FILES).not.toContain(unlisted);
    expect(tiers.contract).toContain(unlisted);
  });

  it('keeps tests that require live repository owners out of the stripped tier', async () => {
    const { HERMETIC_TEST_FILES, classifyHarnessTestFiles } = tierOwner;
    const tiers = classifyHarnessTestFiles(REPO_ROOT);
    const repositoryContractTests = [
      'scripts/harness/__tests__/scan-file-size.test.mjs',
      'scripts/harness/__tests__/verification-receipt.test.mjs',
    ];

    for (const file of repositoryContractTests) {
      expect(HERMETIC_TEST_FILES).not.toContain(file);
      expect(tiers.contract).toContain(file);
    }
  });

  it('declares only files that exist', async () => {
    const { HERMETIC_TEST_FILES } = tierOwner;
    for (const file of HERMETIC_TEST_FILES) {
      expect(existsSync(path.join(REPO_ROOT, file)), file).toBe(true);
    }
  });

  it('runs each tier exactly once from the full root command', () => {
    const scripts = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).scripts;
    expect(scripts['harness:test:contracts']).toContain('--tier contracts');
    expect(scripts['harness:test:contracts']).not.toContain('--verify-hermetic-stripped');
    expect(scripts['harness:test:hermetic']).toContain('--verify-hermetic-stripped');
    expect(scripts['harness:test']).toContain('--tier contracts');
    expect(scripts['harness:test']).toContain('--verify-hermetic-stripped');
    expect(scripts['harness:test']).not.toContain('--tier all');
    expect(scripts['harness:test:tiers:guard']).toContain('--verify-hermetic-stripped');
  });
});

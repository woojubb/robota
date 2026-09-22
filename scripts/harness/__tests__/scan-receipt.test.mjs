/** Per-scan success caching: audited inputs and execution identity or a mandatory miss. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { isCleanTree, realDirtyLines } from '../verification-receipt-storage.mjs';
import { scanSuccessInputs } from '../run-all-scans.mjs';

import {
  SCAN_SUCCESS_CACHE_SCHEMA,
  TREE_EXTERNAL_SCANS,
  applyScanSuccessCache,
  inspectScanSuccessCache,
  recordSuccessfulScanResults,
} from '../scan-receipt.mjs';

const SCAN_SUCCESS_IDENTITY = {
  nodeVersion: 'v22.14.0',
  platform: 'linux',
  architecture: 'x64',
  pnpmVersion: '10.0.0',
  gitVersion: 'git version 2.51.0',
  bashVersion: 'GNU bash, version 5.2.21',
  lockfileHash: 'b'.repeat(64),
  runnerEnvironment: {
    CI: 'true',
    COMSPEC: '',
    FORCE_COLOR: '',
    GITHUB_ACTIONS: 'true',
    HOME: '/home/runner',
    ImageOS: 'ubuntu24',
    ImageVersion: '20260920.1',
    LANG: 'C.UTF-8',
    LC_ALL: '',
    NODE_OPTIONS: '',
    NO_COLOR: '',
    PATH: '/usr/bin:/bin',
    PATHEXT: '',
    RUNNER_ARCH: 'X64',
    RUNNER_OS: 'Linux',
    SHELL: '/bin/bash',
    SystemRoot: '',
    TEMP: '/tmp/temp',
    TMP: '/tmp/tmp',
    TMPDIR: '/tmp/tmpdir',
    TZ: 'UTC',
    USERPROFILE: '',
    WINDIR: '',
  },
};

function scanCacheInputs(root, scanNames) {
  const scanInputs = new Map();
  const scanCommands = new Map();
  const files = new Map();
  for (const scan of scanNames) {
    const file = `inputs/${scan}.txt`;
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `${scan}:v1\n`);
    files.set(scan, file);
    scanInputs.set(scan, { patterns: [`inputs/${scan}.*`], files: [file] });
    scanCommands.set(scan, ['node', `scripts/${scan}.mjs`]);
  }
  return { scanInputs, scanCommands, files };
}

describe('scans whose inputs are not in the tree', () => {
  it('names them, so adding one later is a visible change', () => {
    expect([...TREE_EXTERNAL_SCANS].sort()).toEqual([
      'action-references',
      'build-contracts',
      'dist',
    ]);
  });

  it('never records the live remote/GitHub half of action-references', () => {
    const root = makeTemp('scan-success-live-action-refs-');
    const cache = inspectScanSuccessCache({
      scanNames: ['action-references'],
      cacheableScanNames: ['action-references'],
      root,
      context: 'pr',
      cacheRoot: path.join(root, 'cache'),
      identity: SCAN_SUCCESS_IDENTITY,
      clean: true,
    });
    expect(cache.records.size).toBe(0);
    expect(
      recordSuccessfulScanResults({
        cache,
        results: [{ name: 'action-references', code: 0, output: 'live success' }],
      }),
    ).toBe(0);
  });
});

describe('independently persisted scan successes', () => {
  it('reruns only failed and tree-external scans after a mixed-result suite', async () => {
    const root = makeTemp('scan-success-cache-');
    const cacheRoot = path.join(root, 'cache');
    const inputs = scanCacheInputs(root, ['passed', 'failed', 'dist']);
    const options = {
      scanNames: ['passed', 'failed', 'dist'],
      cacheableScanNames: ['passed', 'failed', 'dist'],
      root,
      context: 'pr',
      cacheRoot,
      identity: SCAN_SUCCESS_IDENTITY,
      clean: true,
      ...inputs,
    };
    const first = inspectScanSuccessCache(options);
    expect(first.hits.size).toBe(0);
    expect(first.misses).toEqual(['passed', 'failed', 'dist']);
    expect(
      recordSuccessfulScanResults({
        cache: first,
        results: [
          { name: 'passed', code: 0, output: '::examined:: 1 fixture' },
          { name: 'failed', code: 1, output: 'failure' },
          { name: 'dist', code: 0, output: 'external pass' },
        ],
      }),
    ).toBe(1);

    const retry = inspectScanSuccessCache(options);
    expect([...retry.hits]).toEqual([['passed', { code: 0, output: '::examined:: 1 fixture' }]]);
    expect(retry.misses).toEqual(['failed', 'dist']);

    const invoked = [];
    const wrapped = applyScanSuccessCache(
      options.scanNames.map((name) => ({
        name,
        run: async () => {
          invoked.push(name);
          return { code: 0, output: '' };
        },
      })),
      retry,
    );
    await Promise.all(wrapped.map((scan) => scan.run()));
    expect(invoked).toEqual(['failed', 'dist']);
  });

  it('never writes failed, unavailable, or tree-external outcomes', () => {
    const root = makeTemp('scan-success-refusal-');
    const inputs = scanCacheInputs(root, ['failed', 'unavailable', 'build-contracts']);
    const cache = inspectScanSuccessCache({
      scanNames: ['failed', 'unavailable', 'build-contracts'],
      cacheableScanNames: ['failed', 'unavailable', 'build-contracts'],
      root,
      context: 'integration',
      cacheRoot: path.join(root, 'cache'),
      identity: SCAN_SUCCESS_IDENTITY,
      clean: true,
      ...inputs,
    });
    expect(
      recordSuccessfulScanResults({
        cache,
        results: [
          { name: 'failed', code: 1, output: '' },
          { name: 'unavailable', code: 0, output: '', unavailable: true },
          { name: 'build-contracts', code: 0, output: '' },
        ],
      }),
    ).toBe(0);
    expect(cache.records.has('build-contracts')).toBe(false);
    expect(existsSync(path.join(root, 'cache'))).toBe(false);
  });

  it('invalidates successes across context and execution-identity changes', () => {
    const root = makeTemp('scan-success-identity-');
    const cacheRoot = path.join(root, 'cache');
    const inputs = scanCacheInputs(root, ['passed']);
    const options = {
      scanNames: ['passed'],
      cacheableScanNames: ['passed'],
      root,
      context: 'pr',
      cacheRoot,
      identity: SCAN_SUCCESS_IDENTITY,
      clean: true,
      ...inputs,
    };
    const first = inspectScanSuccessCache(options);
    recordSuccessfulScanResults({
      cache: first,
      results: [{ name: 'passed', code: 0, output: '' }],
    });
    expect(inspectScanSuccessCache(options).hits.has('passed')).toBe(true);
    expect(inspectScanSuccessCache({ ...options, context: 'integration' }).hits.size).toBe(0);
    expect(
      inspectScanSuccessCache({
        ...options,
        identity: { ...SCAN_SUCCESS_IDENTITY, gitVersion: 'git version changed' },
      }).hits.size,
    ).toBe(0);
    for (const key of Object.keys(SCAN_SUCCESS_IDENTITY.runnerEnvironment)) {
      expect(
        inspectScanSuccessCache({
          ...options,
          identity: {
            ...SCAN_SUCCESS_IDENTITY,
            runnerEnvironment: {
              ...SCAN_SUCCESS_IDENTITY.runnerEnvironment,
              [key]: `${SCAN_SUCCESS_IDENTITY.runnerEnvironment[key]}:changed`,
            },
          },
        }).hits.size,
        key,
      ).toBe(0);
    }
  });

  it('survives unrelated commits but invalidates relevant content, patterns, and commands', () => {
    const root = makeTemp('scan-success-inputs-');
    const inputs = scanCacheInputs(root, ['passed']);
    const options = {
      scanNames: ['passed'],
      cacheableScanNames: ['passed'],
      root,
      context: 'pr',
      cacheRoot: path.join(root, 'cache'),
      identity: SCAN_SUCCESS_IDENTITY,
      clean: true,
      ...inputs,
    };
    const first = inspectScanSuccessCache(options);
    recordSuccessfulScanResults({
      cache: first,
      results: [{ name: 'passed', code: 0, output: '' }],
    });

    writeFileSync(path.join(root, 'unrelated.txt'), 'unrelated change\n');
    expect(inspectScanSuccessCache(options).hits.has('passed')).toBe(true);

    const relevant = path.join(root, inputs.files.get('passed'));
    writeFileSync(relevant, 'passed:v2\n');
    expect(inspectScanSuccessCache(options).hits.size).toBe(0);
    writeFileSync(relevant, 'passed:v1\n');
    expect(inspectScanSuccessCache(options).hits.has('passed')).toBe(true);

    const changedPatterns = new Map(inputs.scanInputs);
    changedPatterns.set('passed', {
      ...inputs.scanInputs.get('passed'),
      patterns: ['inputs/passed.txt'],
    });
    expect(inspectScanSuccessCache({ ...options, scanInputs: changedPatterns }).hits.size).toBe(0);

    const changedCommands = new Map(inputs.scanCommands);
    changedCommands.set('passed', ['node', 'scripts/passed.mjs', '--strict']);
    expect(inspectScanSuccessCache({ ...options, scanCommands: changedCommands }).hits.size).toBe(
      0,
    );
  });

  it('invalidates a success when a transitive scan implementation helper changes', () => {
    const root = makeTemp('scan-success-import-closure-');
    writeFileSync(
      path.join(root, 'scan.mjs'),
      "import { helper } from './helper.mjs';\nhelper();\n",
    );
    writeFileSync(
      path.join(root, 'helper.mjs'),
      "import { value } from './nested.mjs';\nexport const helper = () => value;\n",
    );
    writeFileSync(path.join(root, 'nested.mjs'), 'export const value = 1;\n');
    const scan = {
      name: 'passed',
      command: ['node', 'scan.mjs'],
      examines: ['governed/**'],
      cacheable: true,
    };
    const options = {
      scanNames: ['passed'],
      cacheableScanNames: ['passed'],
      scanInputs: scanSuccessInputs([scan], ['scan.mjs', 'helper.mjs', 'nested.mjs'], root),
      scanCommands: new Map([['passed', scan.command]]),
      root,
      context: 'pr',
      cacheRoot: path.join(root, 'cache'),
      identity: SCAN_SUCCESS_IDENTITY,
      clean: true,
    };
    const first = inspectScanSuccessCache(options);
    recordSuccessfulScanResults({
      cache: first,
      results: [{ name: 'passed', code: 0, output: '' }],
    });
    expect(inspectScanSuccessCache(options).hits.has('passed')).toBe(true);

    writeFileSync(path.join(root, 'nested.mjs'), 'export const value = 2;\n');
    expect(inspectScanSuccessCache(options).hits.size).toBe(0);
  });

  it('never creates records for history/base/live scans without an audited cacheable declaration', () => {
    const root = makeTemp('scan-success-history-');
    for (const identity of [
      { ...SCAN_SUCCESS_IDENTITY, headCommit: 'head-a', baseRef: 'base-a' },
      { ...SCAN_SUCCESS_IDENTITY, headCommit: 'head-b', baseRef: 'base-b' },
    ]) {
      const cache = inspectScanSuccessCache({
        scanNames: ['promotion-ancestry', 'document-authority'],
        cacheableScanNames: [],
        root,
        context: 'pr',
        cacheRoot: path.join(root, 'cache'),
        identity,
        clean: true,
      });
      expect(cache.hits.size).toBe(0);
      expect(cache.records.size).toBe(0);
      expect(cache.misses).toEqual(['promotion-ancestry', 'document-authority']);
    }
  });

  it('is persisted by both repository-check workflows even when a sibling fails', () => {
    expect(SCAN_SUCCESS_CACHE_SCHEMA).toBe('robota-scan-success-v2');
    for (const file of ['.github/workflows/ci.yml', '.github/workflows/scans-full.yml']) {
      const source = readFileSync(
        path.join(path.resolve(import.meta.dirname, '../../..'), file),
        'utf8',
      );
      expect(source).toContain('path: .cache/robota-scan-successes');
      expect(source).toContain('robota-scan-success-v2-${{ runner.os }}-node22-');
      expect(source).toMatch(
        /name: Persist independently proven scan successes\n\s+if: \$\{\{ always\(\) \}\}/,
      );
    }
  });
});

describe('scan-success cache eligibility in a real agent clone', () => {
  /**
   * The hole this closes was not theoretical: an untracked file the agent harness writes into every
   * clone made `isCleanTree()` false for whole sessions, so no success marker was ever reusable.
   * The ignore rule is a CLASS, and this asserts the class matches —
   * without it the assertion would be about git, which is not ours to test.
   */
  it('a per-clone harness config file does not make the tree dirty', () => {
    const root = makeTemp('harness-109-');
    try {
      const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
      git('init', '-q');
      git('config', 'user.email', 'test@example.com');
      git('config', 'user.name', 'test');
      writeFileSync(path.join(root, '.gitignore'), '.claude/*.local.json\n');
      git('add', '.gitignore');
      git('commit', '-qm', 'root');

      expect(isCleanTree(root)).toBe(true);

      mkdirSync(path.join(root, '.claude'), { recursive: true });
      writeFileSync(path.join(root, '.claude', 'settings.local.json'), '{}\n');
      expect(isCleanTree(root)).toBe(true);

      // The exemption is narrow: anything else still makes the tree unclean, so cached success can
      // never stand behind a tree a human changed.
      writeFileSync(path.join(root, '.claude', 'settings.json'), '{}\n');
      expect(realDirtyLines(root)).toEqual(['?? .claude/settings.json']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

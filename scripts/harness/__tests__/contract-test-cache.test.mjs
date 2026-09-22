import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';
import {
  CONTRACT_TEST_GLOBAL_INPUTS,
  CONTRACT_TEST_CACHE_SCHEMA,
  createContractTestCacheKey,
  inspectContractTestCache,
  recordSuccessfulContractShard,
  resolveContractExecutionContext,
} from '../contract-test-cache.mjs';
import { CONTRACT_CONTROL_PLANE_INPUTS } from '../contract-test-inputs.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const EXECUTION_CONTEXT = Object.freeze({
  architecture: 'test-arch',
  bashVersion: 'GNU bash, version test',
  'environment.COMSPEC': '',
  'environment.CI': 'true',
  'environment.FORCE_COLOR': '',
  'environment.GITHUB_ACTIONS': 'true',
  'environment.HARNESS_CONTRACT_SHARD_TIMEOUT_MS': '120000',
  'environment.HOME': '/test/home',
  'environment.ImageOS': 'ubuntu22',
  'environment.ImageVersion': 'test-image',
  'environment.LANG': 'C.UTF-8',
  'environment.LC_ALL': 'C.UTF-8',
  'environment.NODE_OPTIONS': '',
  'environment.NO_COLOR': '',
  'environment.PATH': '/test/bin:/usr/bin',
  'environment.PATHEXT': '',
  'environment.RUNNER_ARCH': 'X64',
  'environment.RUNNER_OS': 'Linux',
  'environment.SHELL': '/bin/bash',
  'environment.SystemRoot': '',
  'environment.TEMP': '/test/temp',
  'environment.TMP': '/test/tmp',
  'environment.TMPDIR': '/test/tmpdir',
  'environment.TZ': 'UTC',
  'environment.USERPROFILE': '',
  'environment.WINDIR': '',
  gitVersion: 'git version test',
  nodeVersion: 'v22.19.0',
  platform: 'test-platform',
});

function fixture() {
  const root = makeTemp('robota-contract-cache-');
  const files = {
    test: 'scripts/harness/__tests__/fixture.test.mjs',
    implementation: 'scripts/harness/fixture-owner.mjs',
    repositoryA: 'docs/a.md',
    repositoryB: 'docs/nested/b.md',
    global: 'runner.config.mjs',
  };
  for (const file of Object.values(files))
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, files.test), "import '../fixture-owner.mjs';\n");
  writeFileSync(path.join(root, files.implementation), 'export const owner = true;\n');
  writeFileSync(path.join(root, files.repositoryA), 'alpha\n');
  writeFileSync(path.join(root, files.repositoryB), 'beta\n');
  writeFileSync(path.join(root, files.global), 'export default {};\n');

  const tracked = Object.values(files).sort();
  const runGit = () => ({ status: 0, stdout: `${tracked.join('\0')}\0`, signal: null });
  const entry = {
    test: files.test,
    always: false,
    alwaysReason: null,
    cacheable: true,
    uncertainInputs: [],
    uncertaintyDispositions: [],
    implementationInputs: [files.test, files.implementation],
    repositoryInputs: ['docs/**'],
  };
  return { root, files, runGit, entry, globalInputs: [files.global] };
}

function inspect(data, entry = data.entry, executionContext = EXECUTION_CONTEXT) {
  return inspectContractTestCache({
    root: data.root,
    entries: [entry],
    tests: [entry.test],
    cacheRoot: path.join(data.root, '.cache', 'robota-contract-tests'),
    globalInputs: data.globalInputs,
    executionContext,
    runGit: data.runGit,
  });
}

function key(data, executionContext = EXECUTION_CONTEXT) {
  return createContractTestCacheKey({
    root: data.root,
    entry: data.entry,
    globalInputs: data.globalInputs,
    executionContext,
    runGit: data.runGit,
  });
}

function declareInput(data, kind, target) {
  const input = kind === 'list-names' ? (target === '.' ? '*' : `${target}/*`) : target;
  data.entry.repositoryInputs = [input];
  data.entry.references = [
    {
      id: 'owner',
      source: data.files.test,
      span: { start: 0, end: 1 },
      kind: 'module',
      resolution: { status: 'resolved', targets: [data.files.implementation], evidenceInputs: [] },
    },
    {
      id: 'input',
      source: data.files.test,
      span: { start: 2, end: 3 },
      kind,
      resolution: { status: 'resolved', targets: [target], evidenceInputs: [] },
    },
  ];
  data.entry.projectedInputs = [
    { targetOrPattern: data.files.test, sensitivity: 'execution', referenceIds: [] },
    {
      targetOrPattern: data.files.implementation,
      sensitivity: 'execution',
      referenceIds: ['owner'],
    },
    {
      targetOrPattern: input,
      sensitivity: kind === 'list-names' ? 'name-set' : 'content',
      referenceIds: ['input'],
    },
  ].sort((a, b) => a.targetOrPattern.localeCompare(b.targetOrPattern));
}

describe('content-addressed contract-test cache', () => {
  it('captures exact runtime, tool, runner-image, and relevant environment identity', () => {
    const calls = [];
    const context = resolveContractExecutionContext({
      environment: {
        CI: 'true',
        GITHUB_ACTIONS: 'true',
        HARNESS_CONTRACT_SHARD_TIMEOUT_MS: '180000',
        HOME: '/home/runner',
        ImageOS: 'ubuntu24',
        ImageVersion: '20260920.1',
        RUNNER_ARCH: 'X64',
        RUNNER_OS: 'Linux',
        PATH: '/opt/hostedtoolcache/node/bin:/usr/bin',
        SHELL: '/usr/bin/bash',
        TEMP: '/runner/temp',
        TMP: '/runner/tmp',
        TMPDIR: '/runner/tmpdir',
      },
      nodeVersion: 'v22.20.1',
      platform: 'linux',
      architecture: 'x64',
      runCommand: (command) => {
        calls.push(command);
        return {
          status: 0,
          signal: null,
          stdout: command === 'git' ? 'git version 2.51.0\n' : 'GNU bash, version 5.2.21\n',
        };
      },
    });

    expect(calls).toEqual(['git', 'bash']);
    expect(context).toMatchObject({
      nodeVersion: 'v22.20.1',
      platform: 'linux',
      architecture: 'x64',
      gitVersion: 'git version 2.51.0',
      bashVersion: 'GNU bash, version 5.2.21',
      'environment.ImageOS': 'ubuntu24',
      'environment.ImageVersion': '20260920.1',
      'environment.HARNESS_CONTRACT_SHARD_TIMEOUT_MS': '180000',
      'environment.HOME': '/home/runner',
      'environment.PATH': '/opt/hostedtoolcache/node/bin:/usr/bin',
      'environment.RUNNER_OS': 'Linux',
      'environment.TEMP': '/runner/temp',
      'environment.TMP': '/runner/tmp',
      'environment.TMPDIR': '/runner/tmpdir',
    });
  });

  it('turns every execution-context change into a miss', () => {
    const data = fixture();
    const cache = inspect(data);
    recordSuccessfulContractShard({
      cache,
      files: [data.entry.test],
      result: { status: 0, signal: null },
    });
    expect(inspect(data)).toMatchObject({ hits: [data.entry.test], misses: [] });

    for (const [field, value] of Object.entries(EXECUTION_CONTEXT)) {
      const changed = { ...EXECUTION_CONTEXT, [field]: `${value}-changed` };
      expect(inspect(data, data.entry, changed), field).toMatchObject({
        hits: [],
        misses: [data.entry.test],
      });
    }
  });

  it('fails closed when an external tool version cannot be resolved', () => {
    const data = fixture();
    expect(() =>
      resolveContractExecutionContext({
        runCommand: () => ({ status: 127, signal: null, stdout: '' }),
      }),
    ).toThrow(/version could not be resolved/);
    expect(
      inspectContractTestCache({
        root: data.root,
        entries: [data.entry],
        tests: [data.entry.test],
        globalInputs: data.globalInputs,
        runGit: data.runGit,
        executionContext: {},
      }),
    ).toMatchObject({ hits: [], misses: [data.entry.test] });
  });

  it('refuses to cache unresolved reference evidence', () => {
    const data = fixture();
    declareInput(data, 'read-content', data.files.repositoryA);
    data.entry.references[1].resolution = { status: 'unresolved', reason: 'nonliteral-reference' };
    data.entry.references[1].expression = 'dynamicPath';
    expect(() => key(data)).toThrow(/invalid contract input uncertainty policy/);
    expect(inspect(data)).toMatchObject({ hits: [], misses: [data.entry.test] });
  });

  it('does not cache an explicitly noncacheable entry', () => {
    const data = fixture();
    data.entry.cacheable = false;
    expect(() => key(data)).toThrow(/not cacheable/);
    expect(inspect(data)).toMatchObject({ hits: [], misses: [data.entry.test] });
  });

  it('hashes directory name sets without treating content-only edits as changed input', () => {
    const data = fixture();
    declareInput(data, 'list-names', 'docs');
    const initial = key(data);
    writeFileSync(path.join(data.root, data.files.repositoryA), 'changed content, same name');
    expect(key(data)).toBe(initial);
    const added = 'docs/new.md';
    writeFileSync(path.join(data.root, added), 'new name');
    const originalRun = data.runGit;
    data.runGit = () => ({ ...originalRun(), stdout: `${originalRun().stdout}${added}\0` });
    expect(key(data)).not.toBe(initial);
  });

  it('hashes an exact content input even before that file is staged', () => {
    const data = fixture();
    const input = 'docs/new.json';
    declareInput(data, 'read-content', input);
    writeFileSync(path.join(data.root, input), 'first');
    const initial = key(data);
    writeFileSync(path.join(data.root, input), 'second');
    expect(key(data)).not.toBe(initial);
  });

  it('includes non-ignored untracked names in a directory enumeration key', () => {
    const data = fixture();
    declareInput(data, 'list-names', 'docs');
    const tracked = Object.values(data.files).join('\0') + '\0';
    let untracked = '';
    data.runGit = (_command, args) => ({
      status: 0,
      signal: null,
      stdout: args.includes('--others') ? untracked : tracked,
    });
    const initial = key(data);
    untracked = 'docs/not-staged.md\0';
    expect(key(data)).not.toBe(initial);
  });

  it('includes immediate subdirectory names implied by tracked descendants', () => {
    const data = fixture();
    declareInput(data, 'list-names', 'docs');
    const initial = key(data);
    const originalRun = data.runGit;
    data.runGit = () => ({
      ...originalRun(),
      stdout: `${originalRun().stdout}docs/new-directory/file.json\0`,
    });
    expect(key(data)).not.toBe(initial);
  });

  it('uses normalized root membership and notices a new top-level directory', () => {
    const data = fixture();
    declareInput(data, 'list-names', '.');
    const initial = key(data);
    const originalRun = data.runGit;
    data.runGit = () => ({
      ...originalRun(),
      stdout: `${originalRun().stdout}docs/deeper/file.json\0`,
    });
    expect(key(data)).toBe(initial);
    data.runGit = () => ({
      ...originalRun(),
      stdout: `${originalRun().stdout}new-owner/file.json\0`,
    });
    expect(key(data)).not.toBe(initial);
  });

  it('does not reuse a legacy empty match for a resolved exact content input', () => {
    const data = fixture();
    const input = 'docs/not-tracked.json';
    writeFileSync(path.join(data.root, input), 'first');
    data.entry.repositoryInputs = [input];
    const repositoryMatches = new Map();
    const options = {
      root: data.root,
      entry: data.entry,
      runGit: data.runGit,
      globalInputs: data.globalInputs,
      repositoryMatches,
    };
    createContractTestCacheKey(options);
    declareInput(data, 'read-content', input);
    const initial = createContractTestCacheKey(options);
    writeFileSync(path.join(data.root, input), 'second');
    expect(createContractTestCacheKey(options)).not.toBe(initial);
  });

  it('uses the selector control-plane SSOT as its global cache dependency list', () => {
    expect(CONTRACT_TEST_GLOBAL_INPUTS).toBe(CONTRACT_CONTROL_PLANE_INPUTS);
    expect(CONTRACT_TEST_GLOBAL_INPUTS).toContain(
      'scripts/harness/harness-test-classification.mjs',
    );
  });

  it('invalidates for implementation, every matching repository file, and global content', () => {
    const data = fixture();
    const initial = key(data);

    writeFileSync(path.join(data.root, data.files.implementation), 'export const owner = false;\n');
    const implementationChanged = key(data);
    expect(implementationChanged).not.toBe(initial);

    writeFileSync(path.join(data.root, data.files.implementation), 'export const owner = true;\n');
    writeFileSync(path.join(data.root, data.files.repositoryB), 'beta changed\n');
    const repositoryChanged = key(data);
    expect(repositoryChanged).not.toBe(initial);

    writeFileSync(path.join(data.root, data.files.repositoryB), 'beta\n');
    writeFileSync(path.join(data.root, data.files.global), 'export default { changed: true };\n');
    expect(key(data)).not.toBe(initial);
  });

  it('treats a corrupt marker as a miss', () => {
    const data = fixture();
    const cache = inspect(data);
    const [record] = cache.records.values();
    mkdirSync(path.dirname(record.file), { recursive: true });
    writeFileSync(record.file, '{not-json');

    expect(inspect(data)).toMatchObject({ hits: [], misses: [data.entry.test] });
  });

  it('never caches an always-run safety test', () => {
    const data = fixture();
    const always = { ...data.entry, always: true, alwaysReason: 'safety floor' };
    const cache = inspect(data, always);

    expect(cache.hits).toEqual([]);
    expect(cache.misses).toEqual([always.test]);
    expect(cache.records.size).toBe(0);
  });

  it('records no markers for a failed or signalled shard', () => {
    const data = fixture();
    const cache = inspect(data);
    const [record] = cache.records.values();

    expect(
      recordSuccessfulContractShard({
        cache,
        files: [data.entry.test],
        result: { status: 1, signal: null },
      }),
    ).toBe(0);
    expect(existsSync(record.file)).toBe(false);
    expect(
      recordSuccessfulContractShard({
        cache,
        files: [data.entry.test],
        result: { status: 1, signal: 'SIGTERM' },
      }),
    ).toBe(0);
    expect(existsSync(record.file)).toBe(false);
  });

  it('atomically records a successful pass marker that becomes a hit', () => {
    const data = fixture();
    const cache = inspect(data);
    const [record] = cache.records.values();

    expect(
      recordSuccessfulContractShard({
        cache,
        files: [data.entry.test],
        result: { status: 0, signal: null },
      }),
    ).toBe(1);
    expect(JSON.parse(readFileSync(record.file, 'utf8'))).toMatchObject({
      key: record.key,
      test: data.entry.test,
      result: 'pass',
    });
    expect(readdirSync(path.dirname(record.file)).some((file) => file.includes('.tmp-'))).toBe(
      false,
    );
    expect(inspect(data)).toMatchObject({ hits: [data.entry.test], misses: [] });
  });

  it('warns without changing the test result when a cache marker cannot be written', () => {
    const data = fixture();
    const cache = inspect(data);
    const record = cache.records.get(data.entry.test);
    const blocker = path.join(data.root, 'not-a-directory');
    writeFileSync(blocker, 'block cache directory creation');
    record.file = path.join(blocker, 'marker.json');
    const warnings = [];

    expect(
      recordSuccessfulContractShard({
        cache,
        files: [data.entry.test],
        result: { status: 0, signal: null },
        warn: (message) => warnings.push(message),
      }),
    ).toBe(0);
    expect(warnings).toEqual([expect.stringContaining('cache write failed')]);
  });

  it('restores cross-head markers under an immutable per-run key and revalidates their content', () => {
    const workflow = readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
    const cacheStepStart = workflow.indexOf('- name: Restore validated contract-test successes');
    const cacheStep = workflow.slice(
      cacheStepStart,
      workflow.indexOf('- run: pnpm install --frozen-lockfile', cacheStepStart),
    );

    expect(cacheStep).toContain('id: contract-cache');
    expect(cacheStep).toContain('uses: actions/cache/restore@v6');
    expect(cacheStep).toContain('path: .cache/robota-contract-tests');
    expect(cacheStep).toContain('${{ github.event.pull_request.head.sha || inputs.head_ref }}');
    expect(cacheStep).toContain('${{ github.run_id }}-${{ github.run_attempt }}');
    expect(cacheStep).toContain('restore-keys:');
    expect(cacheStep).toContain(`${CONTRACT_TEST_CACHE_SCHEMA}-` + '${{ runner.os }}-node22-');

    for (const file of ['.github/workflows/ci.yml', '.github/workflows/scans-full.yml']) {
      const source = readFileSync(path.join(REPO_ROOT, file), 'utf8');
      expect(source).toContain('uses: actions/cache/save@v6');
      expect(source).toMatch(
        /name: Persist independently proven contract successes\n\s+if: \$\{\{ always\(\) \}\}/,
      );
      expect(source).toContain('key: ${{ steps.contract-cache.outputs.cache-primary-key }}');
      expect(source).not.toContain('uses: actions/cache@v6');
    }
  });
});

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { CODING_TASKS } from './outcome-coding-tasks.js';
import {
  buildVerifierContainerArgs,
  materializeTask,
  observeTree,
  readObservation,
  runTrustedControl,
  writeObservationOnce,
} from './outcome-coding-verify.js';

function task(id: string) {
  const found = CODING_TASKS.find((candidate) => candidate.id === id);
  assert.ok(found, id);
  return found;
}

function withTree<T>(id: string, kind: 'broken' | 'solved', use: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'coding-verify-test-'));
  try {
    materializeTask(task(id), root, kind);
    return use(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('trusted controls: broken fails and solved passes for every task', () => {
  assert.equal(CODING_TASKS.length, 5);
  for (const definition of CODING_TASKS) {
    const broken = runTrustedControl(definition, 'broken');
    const solved = runTrustedControl(definition, 'solved');
    assert.notEqual(broken.exitCode, 0, `${definition.id} broken control must fail`);
    assert.equal(solved.exitCode, 0, `${definition.id} solved control must pass`);
    for (const observation of [broken, solved]) {
      assert.equal(observation.protectedFilesUnchanged, true);
      assert.equal(observation.noUnexpectedFiles, true);
      assert.equal(observation.noEscapes, true);
      assert.equal(observation.timedOut, false);
    }
  }
});

test('the manifest lists every file with its digest and mode, sorted', () => {
  withTree('multi-file', 'solved', (root) => {
    const observation = observeTree(task('multi-file'), root, { exitCode: 0 });
    assert.deepEqual(
      observation.manifest.map((entry) => [entry.path, entry.mode]),
      [
        ['src/invoice.mjs', '0644'],
        ['src/units.mjs', '0644'],
      ],
    );
    for (const entry of observation.manifest) assert.match(entry.sha256, /^[0-9a-f]{64}$/);
  });
});

test('an observation file can be written once and a second write is refused', () => {
  withTree('feature', 'solved', (root) => {
    const observation = observeTree(task('feature'), root, { exitCode: 0 });
    const store = mkdtempSync(join(tmpdir(), 'coding-observation-'));
    const target = join(store, 'observation.json');
    try {
      writeObservationOnce(target, observation);
      assert.deepEqual(readObservation(target), observation);
      assert.throws(
        () => writeObservationOnce(target, { ...observation, exitCode: 1 }),
        (error: NodeJS.ErrnoException) => error.code === 'EEXIST',
      );
      assert.deepEqual(readObservation(target), observation);
    } finally {
      rmSync(store, { recursive: true, force: true });
    }
  });
});

test('a changed or removed protected file is reported', () => {
  withTree('navigation', 'solved', (root) => {
    writeFileSync(join(root, 'src/main.mjs'), 'export {};\n');
    rmSync(join(root, 'src/display.mjs'));
    const observation = observeTree(task('navigation'), root, { exitCode: 0 });
    assert.equal(observation.protectedFilesUnchanged, false);
    assert.deepEqual([...observation.changedProtectedFiles].sort(), [
      'src/display.mjs',
      'src/main.mjs',
    ]);
  });
});

test('an unexpected file, including one in a new directory, is reported', () => {
  withTree('bug-repair', 'solved', (root) => {
    writeFileSync(join(root, 'notes.txt'), 'x');
    mkdirSync(join(root, 'extra/deep'), { recursive: true });
    writeFileSync(join(root, 'extra/deep/file.mjs'), 'x');
    const observation = observeTree(task('bug-repair'), root, { exitCode: 0 });
    assert.equal(observation.noUnexpectedFiles, false);
    assert.deepEqual([...observation.unexpectedFiles].sort(), ['extra/deep/file.mjs', 'notes.txt']);
    assert.equal(observation.noEscapes, true);
  });
});

test('symlinks are escapes and are never followed', () => {
  const outside = mkdtempSync(join(tmpdir(), 'coding-outside-'));
  try {
    writeFileSync(join(outside, 'secret.txt'), 'secret');
    withTree('navigation', 'broken', (root) => {
      symlinkSync(join(outside, 'secret.txt'), join(root, 'answer.json'));
      symlinkSync(outside, join(root, 'linked-dir'));
      symlinkSync('../../etc/hosts', join(root, 'src/catalog.mjs.link'));
      const observation = observeTree(task('navigation'), root, { exitCode: 0 });
      assert.equal(observation.noEscapes, false);
      assert.deepEqual([...observation.escapes].sort(), [
        'answer.json',
        'linked-dir',
        'src/catalog.mjs.link',
      ]);
      assert.equal(
        observation.manifest.some((entry) => entry.path === 'answer.json'),
        false,
      );
    });
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test('a protected file replaced by a symlink counts as changed and as an escape', () => {
  const outside = mkdtempSync(join(tmpdir(), 'coding-outside-'));
  try {
    withTree('test-diagnosis', 'solved', (root) => {
      writeFileSync(join(outside, 'range.test.mjs'), 'x');
      rmSync(join(root, 'tests/range.test.mjs'));
      symlinkSync(join(outside, 'range.test.mjs'), join(root, 'tests/range.test.mjs'));
      const observation = observeTree(task('test-diagnosis'), root, { exitCode: 0 });
      assert.deepEqual(observation.changedProtectedFiles, ['tests/range.test.mjs']);
      assert.equal(observation.protectedFilesUnchanged, false);
      assert.deepEqual(observation.escapes, ['tests/range.test.mjs']);
    });
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test('container arguments are golden', () => {
  const args = buildVerifierContainerArgs({
    name: 'verifier-1',
    image: 'node:22',
    root: '/tmp/tree',
    task: { verifier: "console.log('ok')" },
  });
  assert.deepEqual(args, [
    'run',
    '--rm',
    '--name',
    'verifier-1',
    '--label',
    'robota.eval=coding-verifier',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--user',
    '1000:1000',
    '--pids-limit',
    '64',
    '--memory',
    '512m',
    '--memory-swap',
    '512m',
    '--cpus',
    '1',
    '--tmpfs',
    '/tmp:rw,nosuid,nodev,noexec,size=16777216',
    '-v',
    '/tmp/tree:/work:ro',
    '-w',
    '/work',
    'node:22',
    'node',
    '--input-type=module',
    '-e',
    "console.log('ok')",
  ]);
});

test('container arguments take custom limits and never mount read-write or enable a network', () => {
  const args = buildVerifierContainerArgs({
    name: 'verifier-2',
    image: 'img',
    root: '/r',
    task: { verifier: 'x' },
    limits: { memory: '64m', cpus: '0.5', pids: 8, timeoutMs: 1000 },
  });
  assert.equal(args[args.indexOf('--memory') + 1], '64m');
  assert.equal(args[args.indexOf('--cpus') + 1], '0.5');
  assert.equal(args[args.indexOf('--pids-limit') + 1], '8');
  assert.equal(args[args.indexOf('--network') + 1], 'none');
  assert.ok(args.includes('--read-only'));
  assert.ok(args.every((arg) => !arg.endsWith(':rw') || arg.startsWith('/tmp:')));
});

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assembleImageContext,
  forbiddenTexts,
  leakNeedles,
  searchTree,
} from './outcome-coding-image.js';
import {
  buildRepositoryFixture,
  hasFixtureCommits,
  REPOSITORY_FIXTURE_SOURCE,
} from './outcome-coding-repository-build.js';
import { planScriptedTrial } from './outcome-coding-scripts.js';
import {
  REPOSITORY_FILES,
  REPOSITORY_FIX_COMMIT,
  REPOSITORY_LEAK_NEEDLES,
  REPOSITORY_PARENT_COMMIT,
  REPOSITORY_SOLVED,
} from './outcome-coding-tasks-repository-data.js';
import {
  ALL_CODING_TASKS,
  REPOSITORY_IMPLEMENTATION,
  REPOSITORY_TASK,
} from './outcome-coding-tasks-repository.js';
import { CODING_TASKS, serializeCodingTasks, taskFiles } from './outcome-coding-tasks.js';
import {
  materializeTask,
  requireFrozenTask,
  runTrustedControl,
  VERIFIER_MOUNT,
} from './outcome-coding-verify.js';

/**
 * Digest of the canonical serialization of the repository task alone. The five synthetic tasks keep
 * their own digest; change this one only on purpose, together with the task data.
 */
const FROZEN_REPOSITORY_TASK_DIGEST =
  '3d0ca904d2075341656ed832158701a46c19a6c7ffa4a0ca635fd964d6ac0142';

const digest = (text: string): string => createHash('sha256').update(text).digest('hex');
const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = 'examples/capabilities/agent-eval';

test('the repository task is frozen on its own and the five synthetic tasks are untouched', () => {
  assert.equal(digest(serializeCodingTasks([REPOSITORY_TASK])), FROZEN_REPOSITORY_TASK_DIGEST);
  assert.deepEqual(
    ALL_CODING_TASKS.map((task) => task.id),
    [...CODING_TASKS.map((task) => task.id), 'repository-fix'],
  );
  assert.equal(CODING_TASKS.length, 5);
  assert.ok(Object.isFrozen(REPOSITORY_TASK));
  assert.ok(Object.isFrozen(REPOSITORY_TASK.files));
  assert.ok(Object.isFrozen(REPOSITORY_TASK.leakNeedles));
  assert.ok(Object.isFrozen(ALL_CODING_TASKS));
  assert.throws(() => ((REPOSITORY_TASK as unknown as { prompt: string }).prompt = 'x'), TypeError);
});

test('the task tree is a pruned export with no history and nothing but what the task needs', () => {
  assert.deepEqual(Object.keys(REPOSITORY_TASK.files).sort(), [
    'packages/agent-roundtable-robota/package.json',
    REPOSITORY_IMPLEMENTATION,
  ]);
  for (const path of Object.keys(REPOSITORY_TASK.files)) {
    assert.ok(!path.split('/').some((part) => part === '.git' || part.startsWith('.git')), path);
    assert.ok(!/\.(pack|idx)$/.test(path), path);
  }
  assert.deepEqual(REPOSITORY_TASK.allowed, [REPOSITORY_IMPLEMENTATION]);
  assert.deepEqual(REPOSITORY_TASK.protectedFiles, [
    'packages/agent-roundtable-robota/package.json',
  ]);
  assert.match(REPOSITORY_PARENT_COMMIT, /^[0-9a-f]{40}$/);
  assert.match(REPOSITORY_FIX_COMMIT, /^[0-9a-f]{40}$/);
  assert.notEqual(REPOSITORY_PARENT_COMMIT, REPOSITORY_FIX_COMMIT);
  assert.equal(REPOSITORY_FIXTURE_SOURCE.parentCommit, REPOSITORY_PARENT_COMMIT);
  assert.equal(REPOSITORY_FIXTURE_SOURCE.fixCommit, REPOSITORY_FIX_COMMIT);
  assert.deepEqual(Object.keys(REPOSITORY_FILES), Object.keys(REPOSITORY_TASK.files));
  assert.deepEqual(Object.keys(REPOSITORY_SOLVED), [REPOSITORY_IMPLEMENTATION]);
});

test('the fix changed lines are absent from everything the model is given', () => {
  assert.ok(REPOSITORY_LEAK_NEEDLES.length >= 5, 'the fix leaves identifying lines to check for');
  const visible = [REPOSITORY_TASK.prompt, ...Object.values(REPOSITORY_TASK.files)];
  for (const needle of REPOSITORY_LEAK_NEEDLES) {
    for (const text of visible) assert.ok(!text.includes(needle), `leaked: ${needle}`);
  }
  // The same lines are what the solved overlay carries, so they really identify the fix.
  const solved = REPOSITORY_TASK.solved[REPOSITORY_IMPLEMENTATION] as string;
  assert.ok(REPOSITORY_LEAK_NEEDLES.some((needle) => solved.includes(needle)));
  assert.notEqual(solved, REPOSITORY_TASK.files[REPOSITORY_IMPLEMENTATION]);
});

test('the prompt reports a symptom and gives away neither the code nor the change', () => {
  const prompt = REPOSITORY_TASK.prompt;
  for (const revealing of [
    'render',
    'quoteContent',
    'LINE_BOUNDARY',
    'regex',
    'regular expression',
    '.ts',
    '\\u',
    'vertical tab',
    'u000B',
    'U+000B',
  ]) {
    assert.ok(!prompt.toLowerCase().includes(revealing.toLowerCase()), `prompt names ${revealing}`);
  }
  for (const needle of REPOSITORY_LEAK_NEEDLES) assert.ok(!prompt.includes(needle));
  // Words of the verifier's program never appear in what the model reads.
  for (const word of ['renderSharedIncrement', 'assert', 'import(']) {
    assert.ok(!prompt.includes(word), word);
  }
  assert.match(prompt, /form feed/);
});

test('the verifier is separate from everything the model sees', () => {
  const verifier = REPOSITORY_TASK.verifier;
  const visible = [REPOSITORY_TASK.prompt, ...Object.values(REPOSITORY_TASK.files)];
  for (const text of visible) assert.ok(!text.includes(verifier));
  assert.ok(!REPOSITORY_TASK.allowed.some((path) => path.includes('verif')));
  assert.ok(verifier.includes(`${VERIFIER_MOUNT}/${REPOSITORY_IMPLEMENTATION}`));
  for (const task of ALL_CODING_TASKS) {
    for (const solved of Object.values(task.solved)) {
      assert.ok(forbiddenTexts([task]).includes(solved));
    }
    assert.ok(forbiddenTexts([task]).includes(task.verifier));
  }
  for (const needle of REPOSITORY_LEAK_NEEDLES) {
    assert.ok(forbiddenTexts(ALL_CODING_TASKS).includes(needle));
  }
});

test('trusted controls for the repository task: broken fails, solved passes', () => {
  const broken = runTrustedControl(REPOSITORY_TASK, 'broken');
  const solved = runTrustedControl(REPOSITORY_TASK, 'solved');
  assert.notEqual(broken.exitCode, 0);
  assert.notEqual(broken.exitCode, null);
  assert.equal(solved.exitCode, 0);
  for (const observation of [broken, solved]) {
    assert.equal(observation.protectedFilesUnchanged, true);
    assert.equal(observation.noUnexpectedFiles, true);
    assert.equal(observation.noEscapes, true);
    assert.equal(observation.timedOut, false);
  }
});

test('the broken control fails on the behavior and not for lack of a working check', () => {
  const root = mkdtempSync(join(tmpdir(), 'coding-repository-broken-'));
  try {
    const run = (kind: 'broken' | 'solved') => {
      rmSync(root, { recursive: true, force: true });
      mkdirSync(root, { recursive: true });
      materializeTask(REPOSITORY_TASK, root, kind);
      return spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          REPOSITORY_TASK.verifier.replaceAll(`${VERIFIER_MOUNT}/`, `${root}/`),
        ],
        { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } },
      );
    };
    const broken = run('broken');
    assert.equal(broken.status, 1);
    // The verifier's own comparison fails, on exactly the input the report describes.
    assert.match(broken.stderr, /AssertionError/);
    assert.match(broken.stderr, /### From moderator/);
    assert.doesNotMatch(
      broken.stderr,
      /ERR_MODULE|ERR_UNKNOWN|ERR_UNSUPPORTED|SyntaxError|Cannot find/,
    );
    assert.equal(run('solved').status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a task that differs from the frozen definition never reaches the trusted runner', () => {
  assert.equal(requireFrozenTask(REPOSITORY_TASK), REPOSITORY_TASK);
  assert.throws(
    () => requireFrozenTask({ ...REPOSITORY_TASK, verifier: 'process.exit(0)' }),
    /not the frozen definition/,
  );
  assert.throws(() =>
    requireFrozenTask({
      ...REPOSITORY_TASK,
      solved: { ...REPOSITORY_TASK.solved, [REPOSITORY_IMPLEMENTATION]: 'export {};\n' },
    }),
  );
});

test('a scripted solve leaves exactly the solved control tree and the other behaviors apply', () => {
  const project = '/work/project';
  const plan = planScriptedTrial(REPOSITORY_TASK, 'solve', project);
  assert.ok(plan);
  const written: Record<string, string> = {};
  for (const step of plan.steps) {
    for (const call of step.toolCalls ?? []) {
      if (call.name !== 'Write') continue;
      const { filePath, content } = call.args as { filePath: string; content: string };
      written[filePath.slice(project.length + 1)] = content;
    }
  }
  assert.deepEqual(
    { ...REPOSITORY_TASK.files, ...written },
    { ...taskFiles(REPOSITORY_TASK, 'solved') },
  );
  assert.deepEqual(
    planScriptedTrial(REPOSITORY_TASK, 'edit-protected', project)?.expectedFailures,
    ['protected-files-changed'],
  );
});

function git(directory: string, ...args: string[]): void {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) if (key.startsWith('GIT_')) delete environment[key];
  execFileSync(
    'git',
    [
      '-C',
      directory,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.invalid',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { env: environment, stdio: 'ignore' },
  );
}

function put(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

test('the image context carries neither the solved overlay nor any other file holding the fix', async () => {
  const solved = REPOSITORY_TASK.solved[REPOSITORY_IMPLEMENTATION] as string;
  const root = mkdtempSync(join(tmpdir(), 'coding-repository-image-source-'));
  const directory = mkdtempSync(join(tmpdir(), 'coding-repository-image-context-'));
  try {
    put(root, 'package.json', JSON.stringify({ packageManager: 'pnpm@10.0.1' }));
    put(root, 'packages/runtime/index.ts', 'export const runtime = 1;\n');
    // The pinned checkout already holds the fix: in the implementation file, in a copy of it in a
    // sibling package, and in a test that quotes one of its lines.
    put(root, REPOSITORY_IMPLEMENTATION, solved);
    put(root, 'packages/sibling/src/render.ts', `// copy\n${solved}`);
    put(
      root,
      'packages/sibling/src/render.test.ts',
      `${REPOSITORY_LEAK_NEEDLES.at(-1) as string}\n`,
    );
    put(root, `${EXAMPLE}/package.json`, '{"name":"robota-capability-agent-eval"}\n');
    put(root, `${EXAMPLE}/tsconfig.json`, '{}\n');
    put(root, `${EXAMPLE}/src/outcome-coding-worker.ts`, 'export {};\n');
    put(root, `${EXAMPLE}/src/outcome-coding-protocol.ts`, 'export {};\n');
    put(root, `${EXAMPLE}/src/outcome-delegation-roles.ts`, 'export {};\n');
    put(root, `${EXAMPLE}/src/outcome-delegation-limits.ts`, 'export {};\n');
    put(
      root,
      `${EXAMPLE}/src/outcome-coding-tasks-repository.ts`,
      `const verifier = ${JSON.stringify(REPOSITORY_TASK.verifier)};\n`,
    );
    put(
      root,
      `${EXAMPLE}/src/outcome-coding-tasks-repository-data.ts`,
      `const solved = ${JSON.stringify(solved)};\n`,
    );
    git(root, 'init', '--quiet');
    git(root, 'add', '-A');
    git(root, 'commit', '--quiet', '-m', 'fixture');

    const context = await assembleImageContext({
      source: root,
      revision: 'HEAD',
      directory,
      nodeImage: 'base-image',
      excludeFilesContaining: leakNeedles(ALL_CODING_TASKS),
    });
    const present = (path: string): boolean => existsSync(join(context.tree, path));
    assert.equal(present('.git'), false);
    assert.equal(present('packages/runtime/index.ts'), true);
    assert.equal(present(REPOSITORY_IMPLEMENTATION), false);
    assert.equal(present('packages/sibling/src/render.ts'), false);
    assert.equal(present('packages/sibling/src/render.test.ts'), false);
    assert.equal(present(`${EXAMPLE}/src/outcome-coding-tasks-repository.ts`), false);
    assert.equal(present(`${EXAMPLE}/src/outcome-coding-tasks-repository-data.ts`), false);
    assert.deepEqual(searchTree(context.tree, forbiddenTexts(ALL_CODING_TASKS)).hits, []);

    // Without the exclusion the same search would find the fix, so the check can fail.
    const unfiltered = await assembleImageContext({
      source: root,
      revision: 'HEAD',
      directory: mkdtempSync(join(tmpdir(), 'coding-repository-image-unfiltered-')),
      nodeImage: 'base-image',
    });
    try {
      assert.ok(searchTree(unfiltered.tree, forbiddenTexts(ALL_CODING_TASKS)).hits.length > 0);
    } finally {
      rmSync(unfiltered.directory, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(directory, { recursive: true, force: true });
  }
});

const repositoryRoot = resolve(here, '../../../..');
test(
  'a fresh export of the two commits reproduces the committed data',
  {
    skip: hasFixtureCommits(repositoryRoot)
      ? false
      : 'the checkout has no history for the two commits (a shallow clone)',
    timeout: 60_000,
  },
  async () => {
    const fixture = await buildRepositoryFixture(repositoryRoot);
    assert.deepEqual(fixture.files, REPOSITORY_FILES);
    assert.deepEqual(fixture.solved, REPOSITORY_SOLVED);
    assert.deepEqual([...fixture.leakNeedles].sort(), [...REPOSITORY_LEAK_NEEDLES].sort());
    assert.equal(fixture.parentCommit, REPOSITORY_PARENT_COMMIT);
    assert.equal(fixture.fixCommit, REPOSITORY_FIX_COMMIT);
    const generated = readFileSync(join(here, 'outcome-coding-tasks-repository-data.ts'), 'utf8');
    assert.ok(generated.includes(REPOSITORY_PARENT_COMMIT));
  },
);

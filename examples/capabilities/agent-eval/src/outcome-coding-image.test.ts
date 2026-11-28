import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import {
  assembleImageContext,
  CREDENTIAL_FILE_PATTERN,
  forbiddenTexts,
  FORBIDDEN_PATH_FRAGMENTS,
  readPnpmPin,
  renderDockerfile,
  searchTree,
  TASK_MARKERS,
} from './outcome-coding-image.js';
import { CODING_TASKS, serializeCodingTasks } from './outcome-coding-tasks.js';

const EXAMPLE = 'examples/capabilities/agent-eval';

function gitEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) if (key.startsWith('GIT_')) delete environment[key];
  return environment;
}

function git(directory: string, ...args: string[]): void {
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
    { env: gitEnvironment(), stdio: 'ignore' },
  );
}

function put(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

/** A small repository with the same shape as the real one: a worker, its manifest and everything it must not carry. */
function fixtureRepository(): { root: string; solution: string } {
  const root = mkdtempSync(join(tmpdir(), 'coding-image-source-'));
  const solution = (CODING_TASKS[1]?.solved['src/cart.mjs'] as string).trimEnd();
  put(root, 'package.json', JSON.stringify({ packageManager: 'pnpm@10.0.1' }));
  put(root, 'packages/runtime/index.ts', 'export const runtime = 1;\n');
  put(root, `${EXAMPLE}/package.json`, '{"name":"robota-capability-agent-eval"}\n');
  put(root, `${EXAMPLE}/tsconfig.json`, '{}\n');
  put(root, `${EXAMPLE}/src/outcome-coding-worker.ts`, 'export {};\n');
  put(root, `${EXAMPLE}/src/outcome-coding-protocol.ts`, 'export {};\n');
  put(
    root,
    `${EXAMPLE}/src/outcome-coding-tasks.ts`,
    `const solved = ${JSON.stringify(solution)};\n`,
  );
  put(root, `${EXAMPLE}/src/outcome-coding-verify.ts`, 'export {};\n');
  put(root, `${EXAMPLE}/fixtures/state-plugin/x.json`, '{}\n');
  put(
    root,
    'research/delegation-topology/baseline/harness/tasks.py',
    `SOLVED = ${JSON.stringify(solution)}\n`,
  );
  git(root, 'init', '--quiet');
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'fixture');
  return { root, solution };
}

test('the image context is an exported tree without solutions, verifiers, the earlier harness or history', async () => {
  const { root, solution } = fixtureRepository();
  const directory = mkdtempSync(join(tmpdir(), 'coding-image-context-'));
  try {
    const context = await assembleImageContext({
      source: root,
      revision: 'HEAD',
      directory,
      nodeImage: 'base-image',
    });
    assert.match(context.commit, /^[0-9a-f]{40}$/);
    const present = (path: string): boolean => existsSync(join(context.tree, path));
    assert.equal(present('.git'), false);
    assert.equal(present('packages/runtime/index.ts'), true);
    assert.equal(present(`${EXAMPLE}/package.json`), true);
    assert.equal(present(`${EXAMPLE}/tsconfig.json`), true);
    assert.equal(present(`${EXAMPLE}/src/outcome-coding-worker.ts`), true);
    assert.equal(present(`${EXAMPLE}/src/outcome-coding-protocol.ts`), true);
    assert.equal(present(`${EXAMPLE}/src/outcome-coding-tasks.ts`), false);
    assert.equal(present(`${EXAMPLE}/src/outcome-coding-verify.ts`), false);
    assert.equal(present(`${EXAMPLE}/fixtures`), false);
    assert.equal(present('research'), false);

    const search = searchTree(context.tree, [solution, ...TASK_MARKERS]);
    assert.deepEqual(search.hits, []);
    assert.ok(search.scanned >= 5);

    const dockerfile = readFileSync(join(directory, 'Dockerfile'), 'utf8');
    assert.match(dockerfile, /^FROM base-image$/m);
    assert.match(dockerfile, /pnpm@10\.0\.1/);
    assert.match(dockerfile, new RegExp(context.commit));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the search reports a solution text and a forbidden path wherever they are', () => {
  const root = mkdtempSync(join(tmpdir(), 'coding-image-search-'));
  try {
    const verifier = CODING_TASKS[0]?.verifier as string;
    put(root, 'a/clean.txt', 'nothing here\n');
    put(root, 'b/leak.js', `prefix ${verifier} suffix`);
    put(root, 'c/outcome-coding-tasks.js', 'x');
    put(root, 'd/delegation-topology/notes.txt', 'x');
    const search = searchTree(root, forbiddenTexts(CODING_TASKS));
    assert.deepEqual(search.hits.map((hit) => hit.path).sort(), [
      'b/leak.js',
      'c/outcome-coding-tasks.js',
      'd/delegation-topology/notes.txt',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('what the search forbids is derived from the frozen tasks and cannot go stale silently', () => {
  const serialized = serializeCodingTasks();
  for (const marker of TASK_MARKERS) {
    assert.ok(serialized.includes(marker), `${marker} no longer occurs in the tasks`);
  }
  const texts = forbiddenTexts(CODING_TASKS);
  for (const task of CODING_TASKS) {
    assert.ok(texts.includes(task.verifier));
    for (const solved of Object.values(task.solved)) assert.ok(texts.includes(solved));
  }
  assert.ok(FORBIDDEN_PATH_FRAGMENTS.length >= 3);
});

test('the Dockerfile pins the package manager, installs from the frozen lockfile and passes no secret', () => {
  const dockerfile = renderDockerfile({ nodeImage: 'img', pnpmVersion: '10.34.9', commit: 'abc' });
  assert.match(dockerfile, /corepack prepare pnpm@10\.34\.9/);
  assert.match(dockerfile, /--frozen-lockfile/);
  assert.match(dockerfile, /--filter robota-capability-agent-eval\.\.\./);
  assert.doesNotMatch(dockerfile, /ARG|\.env|KEY|TOKEN|SECRET/);
  assert.throws(() => readPnpmPin(mkdtempSync(join(tmpdir(), 'coding-no-pin-'))));
});

test('credential-like file names are recognized, and the templates that ship in the repository are not', () => {
  for (const name of [
    '.env',
    '.env.local',
    'apps/x/.env.production',
    'certs/server.pem',
    'k/id_rsa',
    'a/b.key',
  ]) {
    assert.ok(CREDENTIAL_FILE_PATTERN.test(name), name);
  }
  for (const name of [
    '.env.example',
    'examples/x/.env.example',
    '.env.default',
    'src/environment.ts',
    'docs/keyboard.md',
  ]) {
    assert.ok(!CREDENTIAL_FILE_PATTERN.test(name), name);
  }
});

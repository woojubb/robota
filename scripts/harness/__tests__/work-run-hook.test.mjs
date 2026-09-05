// harness-coverage: work-run-pending-receipt.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { pendingTerminalReceiptCorrelation } from '../work-run-pending-receipt.mjs';
import { makeTemp } from './make-temp.mjs';

const sourceRoot = fileURLToPath(new URL('../../..', import.meta.url));
const EXECUTABLE_MODE = 0o755; // eslint-disable-line no-magic-numbers -- POSIX executable file mode
const workRunCli = join(sourceRoot, 'scripts/harness/work-run.mjs');
const OUTER_SUBJECT_ENVIRONMENT = [
  'GITHUB_ACTIONS',
  'GITHUB_EVENT_NAME',
  'GITHUB_EVENT_PATH',
  'GITHUB_HEAD_REF',
  'GITHUB_PR_HEAD_SHA',
  'PR_HEAD_SHA',
];

function isolatedEnvironment(overrides = {}) {
  const env = { ...process.env };
  for (const name of OUTER_SUBJECT_ENVIRONMENT) delete env[name];
  return { ...env, ...overrides };
}

function git(root, ...args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: isolatedEnvironment(),
  }).trim();
}

function dispatcherFixture(name, target) {
  const root = makeTemp(`work-run-${name}-`);
  mkdirSync(join(root, '.husky/_'), { recursive: true });
  cpSync(join(sourceRoot, '.husky/_/h'), join(root, '.husky/_/h'));
  cpSync(join(sourceRoot, `.husky/_/${name}`), join(root, `.husky/_/${name}`));
  chmodSync(join(root, `.husky/_/${name}`), EXECUTABLE_MODE);
  if (target) {
    writeFileSync(join(root, `.husky/${name}`), target.source);
    chmodSync(join(root, `.husky/${name}`), target.mode);
  }
  return root;
}

function runDispatcher(root, name, args = []) {
  return spawnSync(join(root, `.husky/_/${name}`), args, {
    cwd: root,
    encoding: 'utf8',
    env: isolatedEnvironment({ HOME: root, XDG_CONFIG_HOME: join(root, '.config') }),
  });
}

function registerDispatcherTests(name) {
  it(`${name} fails closed with the real Husky h when its tracked target is missing`, () => {
    const root = dispatcherFixture(name);

    const result = runDispatcher(root, name);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('tracked hook target is missing or not executable');
  });

  it(`${name} fails closed with the real Husky h when its tracked target is not executable`, () => {
    const root = dispatcherFixture(name, {
      source: '#!/usr/bin/env sh\nprintf reached > target-ran\n',
      mode: 0o644,
    });

    const result = runDispatcher(root, name);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('tracked hook target is missing or not executable');
    expect(existsSync(join(root, 'target-ran'))).toBe(false);
  });

  it(`${name} preserves real Husky h execution and forwards hook arguments`, () => {
    const root = dispatcherFixture(name, {
      source: '#!/usr/bin/env sh\nprintf "%s\\n" "$@" > hook-arguments\n',
      mode: EXECUTABLE_MODE,
    });

    const result = runDispatcher(root, name, ['first', 'second']);

    expect(result.status).toBe(0);
    expect(readFileSync(join(root, 'hook-arguments'), 'utf8')).toBe('first\nsecond\n');
  });
}

function verifyCommitHooks() {
  const root = makeTemp('work-run-hook-');
  git(root, 'init', '-b', 'develop');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.test');
  git(root, 'remote', 'add', 'origin', 'https://github.com/woojubb/robota.git');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  cpSync(join(sourceRoot, 'scripts/harness'), join(root, 'scripts/harness'), { recursive: true });
  mkdirSync(join(root, '.husky'), { recursive: true });
  cpSync(join(sourceRoot, '.husky/post-checkout'), join(root, '.husky/post-checkout'));
  cpSync(join(sourceRoot, '.husky/prepare-commit-msg'), join(root, '.husky/prepare-commit-msg'));
  git(root, 'config', 'core.hooksPath', '.husky');
  writeFileSync(join(root, 'README.md'), 'base\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'chore: base');

  git(root, 'checkout', '-b', 'codex/measured');
  const pointers = join(root, '.git/robota-work-runs/branches');
  expect(existsSync(pointers)).toBe(true);
  writeFileSync(join(root, 'README.md'), 'changed\n');
  git(root, 'add', 'README.md');
  git(root, 'commit', '-m', 'docs: measured change');
  const message = git(root, 'log', '-1', '--format=%B');
  expect(message).toMatch(/Work-Run: [0-9a-f-]{36}/);
  expect(message).toContain('Work-Receipt: g0-r0');
  expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe('changed\n');
}

function workRun(root, ...args) {
  return JSON.parse(
    execFileSync(process.execPath, [workRunCli, ...args, '--root', root], {
      cwd: root,
      encoding: 'utf8',
      env: isolatedEnvironment(),
    }),
  );
}

function receiptClosureFixture({ claimOnCheckout }) {
  const root = realpathSync(makeTemp('work-run-receipt-hook-'));
  git(root, 'init', '-b', 'develop');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.test');
  git(root, 'remote', 'add', 'origin', 'https://github.com/woojubb/robota.git');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  cpSync(join(sourceRoot, 'scripts/harness'), join(root, 'scripts/harness'), { recursive: true });
  mkdirSync(join(root, '.husky'), { recursive: true });
  cpSync(join(sourceRoot, '.husky/post-checkout'), join(root, '.husky/post-checkout'));
  cpSync(join(sourceRoot, '.husky/prepare-commit-msg'), join(root, '.husky/prepare-commit-msg'));
  git(root, 'config', 'core.hooksPath', '.git/no-hooks');
  writeFileSync(join(root, '.gitignore'), '.agents/evals/local-metrics/\n');
  writeFileSync(join(root, 'README.md'), 'base\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'chore: base');
  git(root, 'update-ref', 'refs/remotes/origin/develop', 'HEAD');
  if (claimOnCheckout) git(root, 'config', 'core.hooksPath', '.husky');
  git(root, 'checkout', '-b', 'codex/receipt-closure');
  return root;
}

function stagedReceiptPath(root, receiptPath) {
  const receiptRelative = relative(root, receiptPath);
  git(root, 'add', '--', receiptRelative);
  return receiptRelative;
}

function verifyExcludedReceiptClosureHook() {
  const root = receiptClosureFixture({ claimOnCheckout: true });
  const excluded = workRun(
    root,
    'exclude',
    '--reason',
    'pure-planning-range',
    '--base',
    'origin/develop',
  );
  stagedReceiptPath(root, excluded.receiptPath);

  git(root, 'commit', '-m', 'chore: close excluded work run');

  const message = git(root, 'log', '-1', '--format=%B');
  expect(message).toContain(`Work-Run: ${excluded.receipt.runId}`);
  expect(message).toContain('Work-Receipt: g0-r0');

  git(root, 'commit', '--amend', '--no-edit');
  expect(git(root, 'log', '-1', '--format=%B')).toBe(message);
}

function verifyIncludedReceiptClosureHook() {
  const root = receiptClosureFixture({ claimOnCheckout: true });
  workRun(
    root,
    'bind',
    '--work-id',
    'OBSERVABILITY-002',
    '--lane',
    'L2',
    '--kind',
    'observability',
  );
  workRun(root, 'start');
  workRun(root, 'phase-start', '--phase', 'implementation');
  writeFileSync(join(root, 'README.md'), 'measured change\n');
  git(root, 'add', 'README.md');
  git(root, 'commit', '-m', 'test: measured implementation');
  workRun(root, 'phase-complete', '--phase', 'implementation');
  const ready = workRun(root, 'ready', '--base', 'origin/develop');
  stagedReceiptPath(root, ready.receiptPath);

  git(root, 'commit', '-m', 'chore: close included work run');

  const message = git(root, 'log', '-1', '--format=%B');
  expect(message).toContain(`Work-Run: ${ready.receipt.runId}`);
  expect(message).toContain('Work-Receipt: g0-r0');
}

function verifyPendingTerminalReceiptWinsOverNewActiveRun() {
  const root = receiptClosureFixture({ claimOnCheckout: true });
  const excluded = workRun(
    root,
    'exclude',
    '--reason',
    'pure-planning-range',
    '--base',
    'origin/develop',
  );
  const next = workRun(root, 'claim');
  expect(next.runId).not.toBe(excluded.receipt.runId);
  stagedReceiptPath(root, excluded.receiptPath);

  git(root, 'commit', '-m', 'chore: close earlier excluded run');

  const message = git(root, 'log', '-1', '--format=%B');
  expect(message).toContain(`Work-Run: ${excluded.receipt.runId}`);
  expect(message).not.toContain(`Work-Run: ${next.runId}`);
}

function verifyStateLostReceiptClosureHook() {
  const root = receiptClosureFixture({ claimOnCheckout: false });
  const runId = 'state-lost-run';
  const recovered = workRun(
    root,
    'recover',
    '--state-lost',
    '--run-id',
    runId,
    '--base',
    'origin/develop',
  );
  stagedReceiptPath(root, recovered.receiptPath);
  writeFileSync(recovered.receiptPath, '{}\n');
  git(root, 'config', 'core.hooksPath', '.husky');

  git(root, 'commit', '-m', 'chore: close state-lost work run');

  const message = git(root, 'log', '-1', '--format=%B');
  expect(message).toContain(`Work-Run: ${runId}`);
  expect(message).toContain('Work-Receipt: g0-r0');
}

function verifyAmbiguousReceiptClosureFailsClosed() {
  const root = receiptClosureFixture({ claimOnCheckout: false });
  const before = git(root, 'rev-parse', 'HEAD');
  for (const runId of ['first-run', 'second-run']) {
    const file = join(root, `.agents/evals/work-runs/${runId}/g0-r0.json`);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, '{}\n');
    git(root, 'add', '--', file.slice(root.length + 1));
  }
  git(root, 'config', 'core.hooksPath', '.husky');

  expect(() => pendingTerminalReceiptCorrelation(root)).toThrow(/ambiguous|exactly one/i);

  const result = spawnSync('git', ['commit', '-m', 'chore: ambiguous closure'], {
    cwd: root,
    encoding: 'utf8',
    env: isolatedEnvironment(),
  });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/ambiguous|exactly one/i);
  expect(git(root, 'rev-parse', 'HEAD')).toBe(before);
}

function verifyMalformedReceiptClosureFailsClosed() {
  const root = receiptClosureFixture({ claimOnCheckout: false });
  const before = git(root, 'rev-parse', 'HEAD');
  const file = join(root, '.agents/evals/work-runs/forged/g0-r0.json');
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify({
      disposition: 'invalid',
      reason: 'state-lost',
      runId: 'forged',
      generation: 0,
      revision: 0,
    })}\n`,
  );
  git(root, 'add', '--', file.slice(root.length + 1));
  git(root, 'config', 'core.hooksPath', '.husky');

  const result = spawnSync('git', ['commit', '-m', 'chore: forged closure'], {
    cwd: root,
    encoding: 'utf8',
    env: isolatedEnvironment(),
  });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/malformed|valid.*receipt/i);
  expect(git(root, 'rev-parse', 'HEAD')).toBe(before);
}

function verifyDetachedCheckoutSkipsClaim() {
  const root = makeTemp('work-run-detached-hook-');
  git(root, 'init', '-b', 'develop');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.test');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  cpSync(join(sourceRoot, 'scripts/harness'), join(root, 'scripts/harness'), { recursive: true });
  mkdirSync(join(root, '.husky'), { recursive: true });
  cpSync(join(sourceRoot, '.husky/post-checkout'), join(root, '.husky/post-checkout'));
  writeFileSync(join(root, 'README.md'), 'base\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'chore: base');
  git(root, 'checkout', '--detach', 'HEAD');

  const result = spawnSync(join(root, '.husky/post-checkout'), [], {
    cwd: root,
    encoding: 'utf8',
    env: isolatedEnvironment(),
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe('');
  expect(existsSync(join(root, '.git/robota-work-runs/branches'))).toBe(false);
}

describe('tracked work-run Git hooks', () => {
  it('does not treat receipts inherited from a merge parent as new closures', () => {
    const root = realpathSync(makeTemp('work-run-merge-receipts-'));
    git(root, 'init', '-b', 'develop');
    git(root, 'config', 'user.name', 'Fixture');
    git(root, 'config', 'user.email', 'fixture@example.test');
    writeFileSync(join(root, 'base.txt'), 'base');
    const existing = '.agents/evals/work-runs/existing/g0-r0.json';
    mkdirSync(join(root, '.agents/evals/work-runs/existing'), { recursive: true });
    writeFileSync(join(root, existing), '{}\n');
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'base');
    git(root, 'checkout', '-b', 'incoming');
    for (const id of ['one', 'two', 'three', 'four']) {
      const dir = join(root, '.agents/evals/work-runs', id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'g0-r0.json'), '{}\n');
    }
    writeFileSync(join(root, 'incoming.txt'), 'ordinary merge content');
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'incoming receipts');
    git(root, 'checkout', 'develop');
    writeFileSync(join(root, 'local.txt'), 'local');
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'local');
    git(root, 'merge', '--no-commit', '--no-ff', 'incoming');
    expect(pendingTerminalReceiptCorrelation(root)).toBeNull();

    const receipt = '.agents/evals/work-runs/one/g0-r0.json';
    writeFileSync(join(root, receipt), '{"changed":true}\n');
    git(root, 'add', receipt);
    expect(() => pendingTerminalReceiptCorrelation(root)).toThrow(
      'exactly one staged receipt path',
    );
    writeFileSync(join(root, receipt), '{}\n');
    git(root, 'add', receipt);
    git(root, 'update-index', '--chmod=+x', receipt);
    expect(() => pendingTerminalReceiptCorrelation(root)).toThrow(
      'exactly one staged receipt path',
    );
    git(root, 'update-index', '--chmod=-x', receipt);
    expect(pendingTerminalReceiptCorrelation(root)).toBeNull();

    const added = '.agents/evals/work-runs/new/g0-r0.json';
    mkdirSync(join(root, '.agents/evals/work-runs/new'), { recursive: true });
    writeFileSync(join(root, added), '{}\n');
    git(root, 'add', added);
    expect(() => pendingTerminalReceiptCorrelation(root)).toThrow(
      'exactly one staged receipt path',
    );
    git(root, 'rm', '--cached', added);
    git(root, 'rm', '--cached', existing);
    expect(() => pendingTerminalReceiptCorrelation(root)).toThrow(
      'exactly one staged receipt path',
    );
    git(root, 'checkout', 'incoming', '--', existing);
    expect(pendingTerminalReceiptCorrelation(root)).toBeNull();

    writeFileSync(join(root, '.git/MERGE_HEAD'), `${'f'.repeat(40)}\n`);
    expect(() => pendingTerminalReceiptCorrelation(root)).toThrow(
      'could not inspect merge parent objects',
    );
  });
  registerDispatcherTests('post-checkout');
  registerDispatcherTests('prepare-commit-msg');
  it('claims on topic checkout and applies trailers through a real commit', verifyCommitHooks);
  it(
    'correlates an included receipt-only closure through the real hook',
    verifyIncludedReceiptClosureHook,
  );
  it(
    'correlates an excluded receipt-only closure through the real hook',
    verifyExcludedReceiptClosureHook,
  );
  it(
    'correlates a state-lost receipt-only closure through the real hook',
    verifyStateLostReceiptClosureHook,
  );
  it(
    'prefers a staged terminal receipt over a newer active run',
    verifyPendingTerminalReceiptWinsOverNewActiveRun,
  );
  it(
    'fails closed when the real hook sees ambiguous receipt-only closures',
    verifyAmbiguousReceiptClosureFailsClosed,
  );
  it(
    'fails closed when the real hook sees a malformed receipt-only closure',
    verifyMalformedReceiptClosureFailsClosed,
  );
  it(
    'skips work-run claim when post-checkout runs on detached HEAD',
    verifyDetachedCheckoutSkipsClaim,
  );
});

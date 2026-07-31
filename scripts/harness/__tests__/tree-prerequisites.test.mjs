/**
 * HARNESS-058 — an unprepared tree must produce a message NAMING the prerequisite.
 *
 * The defect these pin: a fresh `git worktree` has no install and no build output, and every gate
 * that needed one reported the absence as a defect in the branch under test (`tsgo: not found`,
 * `Cannot find package '@typescript/native-preview'`, `Cannot find module '…/dist/node/index.js'`).
 * Four sub-agents each spent real effort proving those reds were not their own, and all four then
 * pushed with `--no-verify`.
 *
 * So the assertions here are about the OUTPUT, not only the boolean: a detector that knows the tree
 * is unbuilt and still prints a module-resolution stack trace has fixed nothing.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  checkTreePrerequisites,
  CONTRACT_DOC,
  describeTree,
  findMissingDist,
  formatPrerequisiteFailure,
  inspectTree,
  isInstalled,
  listBuildablePackageDirs,
  PREREQUISITE_ORDER,
  remedyCommands,
} from '../tree-prerequisites.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

function createFixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'tree-prerequisites-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

const BUILDABLE_MANIFEST = JSON.stringify({ scripts: { 'build:js': 'tsdown' } });

// ---------------------------------------------------------------------------
// detection
// ---------------------------------------------------------------------------

describe('isInstalled', () => {
  it('is false when the tree has no pnpm install marker of its OWN', () => {
    const root = createFixture({ 'package.json': '{}' });
    expect(isInstalled(root)).toBe(false);
  });

  it('is false for a bare node_modules directory with no pnpm marker', () => {
    // A nested worktree can inherit stray directories; only the marker proves `pnpm install` ran here.
    const root = createFixture({ 'node_modules/left-over/index.js': '' });
    expect(isInstalled(root)).toBe(false);
  });

  it('is true once pnpm has written its install marker', () => {
    const root = createFixture({ 'node_modules/.modules.yaml': 'hoistPattern: []\n' });
    expect(isInstalled(root)).toBe(true);
  });

  it('recognises this repository checkout as installed', () => {
    expect(isInstalled(WORKSPACE_ROOT)).toBe(true);
  });
});

describe('listBuildablePackageDirs / findMissingDist', () => {
  it('lists only packages that declare build:js, including the nested dag-nodes family', () => {
    const root = createFixture({
      'packages/built/package.json': BUILDABLE_MANIFEST,
      'packages/no-build/package.json': JSON.stringify({ scripts: { test: 'vitest' } }),
      'packages/dag-nodes/nested/package.json': BUILDABLE_MANIFEST,
    });
    expect(listBuildablePackageDirs(root)).toEqual(['packages/built', 'packages/dag-nodes/nested']);
  });

  it('reports the dirs with no dist/', () => {
    const root = createFixture({
      'packages/built/dist/index.js': '',
      'packages/unbuilt/package.json': BUILDABLE_MANIFEST,
    });
    expect(findMissingDist(['packages/built', 'packages/unbuilt'], undefined, root)).toEqual([
      'packages/unbuilt',
    ]);
  });
});

/**
 * These use REAL git repositories and REAL `git worktree add`. `describeTree` asks git rather than
 * inspecting `.git` by hand, so a fixture that fakes the `.git` layout would be testing a heuristic
 * the code no longer uses.
 */
function createGitRepo() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'tree-prerequisites-git-')));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'harness@example.test');
  git('config', 'user.name', 'harness');
  writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git('add', 'seed.txt');
  git('commit', '-qm', 'seed');
  return { root, git };
}

describe('describeTree', () => {
  it('calls the main clone a clone', () => {
    const { root } = createGitRepo();
    expect(describeTree(root).kind).toBe('clone');
  });

  it('resolves a linked worktree to its parent clone and marks it nested', () => {
    const { root, git } = createGitRepo();
    const nested = path.join(root, 'nested-wt');
    git('worktree', 'add', '-q', '-b', 'nested-branch', nested);
    const described = describeTree(nested);
    expect(described.kind).toBe('worktree');
    expect(described.parent).toBe(root);
    expect(described.nested).toBe(true);
  });

  it('marks a worktree outside the parent clone as NOT nested', () => {
    const { root, git } = createGitRepo();
    const sibling = path.join(
      realpathSync(mkdtempSync(path.join(tmpdir(), 'tree-prerequisites-sibling-'))),
      'wt',
    );
    git('worktree', 'add', '-q', '-b', 'sibling-branch', sibling);
    const described = describeTree(sibling);
    expect(described.kind).toBe('worktree');
    expect(described.parent).toBe(root);
    expect(described.nested).toBe(false);
  });

  it('calls a path outside any repository unknown', () => {
    expect(describeTree(createFixture({ 'package.json': '{}' })).kind).toBe('unknown');
  });
});

describe('inspectTree', () => {
  it('reports install BEFORE build-output — install produces what build needs', () => {
    const root = createFixture({ 'packages/unbuilt/package.json': BUILDABLE_MANIFEST });
    expect(inspectTree(root).missing).toEqual(['install', 'build-output']);
  });

  it('reports only build-output once the tree carries its own install', () => {
    const root = createFixture({
      'node_modules/.modules.yaml': '',
      'packages/unbuilt/package.json': BUILDABLE_MANIFEST,
    });
    expect(inspectTree(root).missing).toEqual(['build-output']);
  });

  it('reports nothing missing for a prepared tree', () => {
    const root = createFixture({
      'node_modules/.modules.yaml': '',
      'packages/built/package.json': BUILDABLE_MANIFEST,
      'packages/built/dist/index.js': '',
    });
    expect(inspectTree(root).missing).toEqual([]);
  });

  it('does not demand build output from a caller that only requires an install', () => {
    const root = createFixture({
      'node_modules/.modules.yaml': '',
      'packages/unbuilt/package.json': BUILDABLE_MANIFEST,
    });
    expect(inspectTree(root, ['install']).missing).toEqual([]);
  });

  it('PREREQUISITE_ORDER is the dependency order the remedy is printed in', () => {
    expect(PREREQUISITE_ORDER).toEqual(['install', 'build-output']);
    expect(remedyCommands(PREREQUISITE_ORDER)).toEqual([
      'pnpm install --frozen-lockfile',
      'pnpm build',
    ]);
  });
});

// ---------------------------------------------------------------------------
// the message — the part that actually closes the item
// ---------------------------------------------------------------------------

describe('formatPrerequisiteFailure', () => {
  /** A real nested worktree, installed by nobody and built by nobody. */
  const unpreparedNested = () => {
    const { root, git } = createGitRepo();
    const nested = path.join(root, 'nested-wt');
    git('worktree', 'add', '-q', '-b', `nested-${Date.now()}`, nested);
    mkdirSync(path.join(nested, 'packages', 'unbuilt'), { recursive: true });
    writeFileSync(path.join(nested, 'packages', 'unbuilt', 'package.json'), BUILDABLE_MANIFEST);
    return inspectTree(nested);
  };

  it('states it is not a verdict on the change', () => {
    const message = formatPrerequisiteFailure('verify-like-ci', unpreparedNested());
    expect(message).toContain('NOT a verdict on your change');
  });

  it('names every missing prerequisite and the command that satisfies it, in order', () => {
    const message = formatPrerequisiteFailure('verify-like-ci', unpreparedNested());
    expect(message).toContain('MISSING  install');
    expect(message).toContain('MISSING  build-output');
    expect(message.indexOf('pnpm install --frozen-lockfile')).toBeLessThan(
      message.indexOf('pnpm build'),
    );
  });

  it('names the tree and its parent clone, because "the deps are right there" is the misdiagnosis', () => {
    const state = unpreparedNested();
    const message = formatPrerequisiteFailure('verify-like-ci', state);
    expect(message).toContain(state.root);
    expect(message).toContain(state.tree.parent);
    expect(message).toContain('does NOT share');
  });

  it('explains a nested worktree by the upward module resolution that makes it look installed', () => {
    const message = formatPrerequisiteFailure('verify-like-ci', unpreparedNested());
    expect(message).toContain('walks UP into the parent');
    expect(message).toContain('tsgo: not found');
  });

  it('explains a sibling worktree by the opposite symptom', () => {
    const { git } = createGitRepo();
    const sibling = path.join(
      realpathSync(mkdtempSync(path.join(tmpdir(), 'tree-prerequisites-sibling-'))),
      'wt',
    );
    git('worktree', 'add', '-q', '-b', `sibling-${Date.now()}`, sibling);
    const message = formatPrerequisiteFailure('verify-like-ci', inspectTree(sibling));
    expect(message).toContain("Could not resolve 'vitest/config'");
  });

  it('routes to the written contract rather than to whoever last worked it out', () => {
    expect(formatPrerequisiteFailure('pre-push', unpreparedNested())).toContain(CONTRACT_DOC);
  });
});

describe('checkTreePrerequisites', () => {
  it('is ok with an empty message on a prepared tree — it must never invent work', () => {
    const root = createFixture({
      'node_modules/.modules.yaml': '',
      'packages/built/package.json': BUILDABLE_MANIFEST,
      'packages/built/dist/index.js': '',
    });
    const result = checkTreePrerequisites('verify-like-ci', root);
    expect(result.ok).toBe(true);
    expect(result.message).toBe('');
  });

  it('is not ok, and carries the naming message, on an unprepared tree', () => {
    const root = createFixture({ 'packages/unbuilt/package.json': BUILDABLE_MANIFEST });
    const result = checkTreePrerequisites('verify-like-ci', root);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('missing a verification prerequisite');
  });
});

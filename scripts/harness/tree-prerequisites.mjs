#!/usr/bin/env node

/**
 * tree-prerequisites — the ONE place that answers "what does this working tree owe before it can be
 * verified?", and the one place that says so in a message naming the prerequisite.
 *
 * WHY (HARNESS-058). `verify-like-ci` and the husky pre-push gate are named across the rules and
 * skills as the verification entry points, and they are run from `git worktree` checkouts, because
 * that is how parallel sub-agents work. A fresh worktree has no `node_modules` and no `dist/`, and
 * every gate that needed one reported the absence as a defect in the branch under test:
 *
 *   sh: 1: tsgo: not found
 *   Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@typescript/native-preview'
 *   Cannot find module '…/packages/agent-command-workflows/node_modules/@robota-sdk/dag-core/dist/node/index.js'
 *   doc-examples scan failed — README code blocks do not typecheck
 *
 * None of those is a verdict on a change. All four read like one. On 2026-08-01 four sub-agents in
 * four worktrees each diagnosed it independently, each correctly, and all four then pushed with
 * `--no-verify` — the gate had trained them to route around it.
 *
 * The distinction this module exists to put in the output: **failed because the code is wrong** vs
 * **failed because this tree was never prepared**. The second refuses to produce a verdict and names
 * what to run; it never reports a pass, so nothing here weakens a gate.
 *
 * THE FRESH-WORKTREE CONTRACT (the single answer that used to live in whoever last worked it out):
 *
 *   1. `pnpm install --frozen-lockfile` — in the worktree ITSELF. A worktree does not share the
 *      parent clone's install, and a pnpm workspace puts a `node_modules` in every package, so there
 *      is nothing to share. Measured cost on a warm store: ~3s.
 *   2. `pnpm build` — for any gate that reads build output.
 *
 *   The two worktree layouts fail in OPPOSITE directions, which is why neither one taught anybody
 *   the contract:
 *     - A SIBLING worktree (outside the repo) cannot start at all: `Could not resolve 'vitest/config'`
 *       — the honest failure, and the one that looks catastrophic.
 *     - A NESTED worktree (e.g. under `.claude/worktrees/`) appears to work, because Node's resolver
 *       walks UP out of the worktree into the parent clone's `node_modules`. It gets further and then
 *       fails at the first thing resolution cannot fake — a workspace binary (`tsgo`, `tsdown`,
 *       `vitest`) or a per-package `node_modules` path — with an error that names neither the tree
 *       nor the install.
 *   Both are the same missing step. Neither says so. That is what this module fixes.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** The prerequisite ids, in the order they must be satisfied — install produces what build needs. */
export const PREREQUISITE_ORDER = ['install', 'build-output'];

/** pnpm writes this on every successful install; its absence means THIS tree was never installed. */
const PNPM_INSTALL_MARKER = path.join('node_modules', '.modules.yaml');

/** Where the written contract lives, quoted in every message so the answer has one address. */
export const CONTRACT_DOC =
  '.agents/backlog/HARNESS-058-verify-like-ci-cannot-go-green-in-a-worktree.md';

// ---------------------------------------------------------------------------
// detection
// ---------------------------------------------------------------------------

/**
 * Whether THIS tree carries its own pnpm install.
 *
 * Deliberately the pnpm marker rather than "does `node_modules` exist": a nested worktree can be
 * handed a stray directory, and Node's upward resolution already makes "an import worked" useless as
 * evidence. The marker is written by the command the contract tells you to run, so it answers the
 * question actually being asked — was `pnpm install` run HERE.
 */
export function isInstalled(root, exists = existsSync) {
  return exists(path.join(root, PNPM_INSTALL_MARKER));
}

/**
 * Workspace dirs that produce build output — a package whose manifest declares `build:js`
 * (the script the root `pnpm build` fans out to). Mirrors the `packages/*` + `packages/dag-nodes/*`
 * set ci.yml archives as `package-dist.tgz`.
 */
export function listBuildablePackageDirs(root) {
  const roots = [path.join(root, 'packages'), path.join(root, 'packages', 'dag-nodes')];
  const dirs = [];
  for (const base of roots) {
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue;
      const manifest = path.join(base, entry.name, 'package.json');
      if (!existsSync(manifest)) continue;
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      if (pkg?.scripts?.['build:js']) dirs.push(path.relative(root, path.join(base, entry.name)));
    }
  }
  return dirs.sort();
}

/** Buildable dirs with no `dist/` — CI restores these before the dist-dependent jobs run. */
export function findMissingDist(dirs, exists = existsSync, root) {
  return dirs.filter((dir) => !exists(path.join(root, dir, 'dist')));
}

/**
 * How this tree relates to the repository, for the message.
 *
 * In a linked worktree `.git` is a FILE containing `gitdir: <parent>/.git/worktrees/<name>`; in the
 * main clone it is a directory. Naming the parent clone matters because the whole misdiagnosis is
 * "but the dependencies are right there" — they are, one directory up, and that is not this tree.
 *
 * ONE stat, not `exists()` then `stat()`: a check-then-use pair on the filesystem is a race (CodeQL
 * js/file-system-race), and `throwIfNoEntry: false` answers both questions — present? directory? —
 * from a single syscall.
 */
export function describeTree(root, { read = readFileSync } = {}) {
  const dotGit = path.join(root, '.git');
  const stats = statSync(dotGit, { throwIfNoEntry: false });
  if (!stats) return { kind: 'unknown', root };
  if (stats.isDirectory()) return { kind: 'clone', root };
  const gitdir = /gitdir:\s*(.+)/.exec(read(dotGit, 'utf8'))?.[1]?.trim();
  const parent = gitdir ? gitdir.replace(/[/\\]\.git[/\\]worktrees[/\\].*$/, '') : undefined;
  return {
    kind: 'worktree',
    root,
    parent,
    nested: Boolean(parent) && root.startsWith(`${parent}${path.sep}`),
  };
}

/**
 * The full prerequisite state of a tree. `required` names which prerequisites the caller depends on,
 * so an entry point that builds for itself does not demand build output up front.
 */
export function inspectTree(root, required = PREREQUISITE_ORDER) {
  const installed = isInstalled(root);
  const buildable = required.includes('build-output') ? listBuildablePackageDirs(root) : [];
  const missingDist = findMissingDist(buildable, existsSync, root);
  const missing = [];
  if (required.includes('install') && !installed) missing.push('install');
  if (required.includes('build-output') && missingDist.length > 0) missing.push('build-output');
  return { root, installed, buildable, missingDist, missing, tree: describeTree(root) };
}

// ---------------------------------------------------------------------------
// the message
// ---------------------------------------------------------------------------

const RULE = '─'.repeat(78);

function describeLocation(tree) {
  if (tree.kind !== 'worktree') return `  tree: ${tree.root}`;
  const layout = tree.nested ? 'NESTED inside' : 'a SIBLING of';
  return (
    `  tree: ${tree.root}\n` +
    `        a git worktree, ${layout} its parent clone ${tree.parent ?? '(unresolved)'}\n` +
    `        a worktree does NOT share that clone's install — pnpm workspaces put a\n` +
    `        node_modules in every package, so there is nothing to share.`
  );
}

function describeMissing(state) {
  const lines = [];
  if (state.missing.includes('install')) {
    lines.push(
      `  MISSING  install       no ${PNPM_INSTALL_MARKER} in THIS tree.`,
      state.tree.nested
        ? `                         Imports may still resolve here — Node walks UP into the parent\n` +
            `                         clone. That stops at the first workspace binary, which is why the\n` +
            `                         error you would have seen is \`tsgo: not found\`, not "no install".`
        : `                         Nothing resolves here at all (e.g. \`Could not resolve 'vitest/config'\`).`,
    );
  }
  if (state.missing.includes('build-output')) {
    const sample = state.missingDist.slice(0, 4).join(', ');
    lines.push(
      `  MISSING  build-output  ${state.missingDist.length} of ${state.buildable.length} buildable package(s) have no dist/.`,
      `                         e.g. ${sample}${state.missingDist.length > 4 ? ` … (+${state.missingDist.length - 4})` : ''}`,
    );
  }
  return lines;
}

/** The commands that satisfy the missing prerequisites, in dependency order. */
export function remedyCommands(missing) {
  const commands = [];
  if (missing.includes('install')) commands.push('pnpm install --frozen-lockfile');
  if (missing.includes('build-output')) commands.push('pnpm build');
  return commands;
}

/**
 * The message. It leads with "not a verdict on your change" on purpose: the failure mode this closes
 * is an agent spending real effort proving a red was not its own, four times over in one day.
 */
export function formatPrerequisiteFailure(entryPoint, state) {
  return [
    '',
    RULE,
    `${entryPoint} did NOT run: this tree is missing a verification prerequisite.`,
    'This is NOT a verdict on your change — nothing about the diff has been measured yet.',
    '',
    describeLocation(state.tree),
    '',
    ...describeMissing(state),
    '',
    '  Run this IN THIS TREE, then re-run the gate:',
    ...remedyCommands(state.missing).map((command) => `    ${command}`),
    '',
    `  The fresh-worktree contract: ${CONTRACT_DOC} § The fresh-worktree contract`,
    RULE,
    '',
  ].join('\n');
}

/**
 * Gate an entry point on its prerequisites. Returns the state so the caller decides how to stop —
 * this module never exits a process it does not own.
 */
export function checkTreePrerequisites(entryPoint, root, required = PREREQUISITE_ORDER) {
  const state = inspectTree(root, required);
  return {
    ...state,
    ok: state.missing.length === 0,
    message: state.missing.length === 0 ? '' : formatPrerequisiteFailure(entryPoint, state),
  };
}

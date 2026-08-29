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

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** The prerequisite ids, in the order they must be satisfied — install produces what build needs. */
export const PREREQUISITE_ORDER = ['install', 'build-output'];

/** pnpm writes this on every successful install; its absence means THIS tree was never installed. */
const PNPM_INSTALL_MARKER = path.join('node_modules', '.modules.yaml');

/** Where the written contract lives, quoted in every message so the answer has one address. */
export const CONTRACT_DOC =
  '.agents/tasks/completed/HARNESS-058-verify-like-ci-cannot-go-green-in-a-worktree.md';

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

/**
 * Buildable dirs with no `dist/` — CI restores these before the dist-dependent jobs run.
 *
 * `root` is required and is NOT defaulted, which is the opposite of the usual convenience and is the
 * point. Review of #1577 found an omitted `root` producing `path.join(undefined, …)` — a TypeError
 * raised deep inside `path`, naming nothing a caller could act on. Defaulting it to the workspace
 * root would have removed the crash and replaced it with something worse: this module exists so a
 * verification result is attributed to the TREE IT WAS MEASURED IN, and a silent default would judge
 * a different tree than the caller meant. That misattribution is the whole defect HARNESS-058 is
 * about, arriving through this module's own convenience.
 */
export function findMissingDist(dirs, exists = existsSync, root) {
  if (typeof root !== 'string' || root === '') {
    throw new TypeError(
      'findMissingDist: `root` is required — name the tree being judged. There is no default, ' +
        'because guessing the tree is the misattribution this module exists to prevent.',
    );
  }
  return dirs.filter((dir) => !exists(path.join(root, dir, 'dist')));
}

/** One `git rev-parse` reading, absolute; empty string when this path is not inside a repository. */
export function readGitPath(root, name) {
  const result = spawnSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', name], {
    encoding: 'utf8',
  });
  return result.status === 0 ? (result.stdout ?? '').trim() : '';
}

/**
 * How this tree relates to the repository, for the message.
 *
 * Asked of GIT, not of the filesystem. Inspecting `.git` (a directory in the main clone, a file
 * containing `gitdir: …` in a linked worktree) means checking a path and then using it — a race
 * CodeQL flags as js/file-system-race, and a heuristic where git already has the exact answer:
 * a linked worktree is precisely a tree whose `--git-dir` differs from its `--git-common-dir`.
 *
 * Naming the parent clone matters because the whole misdiagnosis is "but the dependencies are right
 * there" — they are, one directory up, and that is not this tree.
 */
export function describeTree(root, readPath = readGitPath) {
  const gitDir = readPath(root, '--git-dir');
  const commonDir = readPath(root, '--git-common-dir');
  if (!gitDir || !commonDir) return { kind: 'unknown', root };
  if (gitDir === commonDir) return { kind: 'clone', root };
  const parent = path.dirname(commonDir);
  return {
    kind: 'worktree',
    root,
    parent,
    nested: root.startsWith(`${parent}${path.sep}`),
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

/** The causes a prerequisite can be unmet. Anything else is a caller bug, not a default. */
export const PREREQUISITE_CAUSES = ['unprepared', 'build-failed'];

/**
 * Why the prerequisite is unmet, and what the reader should do about it.
 *
 * `build-failed` exists because "run `pnpm build`" is the wrong instruction to hand someone who has
 * just watched `pnpm build` fail on their own regression. The missing output is a CONSEQUENCE of a
 * failure already reported above, and the message has to say so or it reads as a second, competing
 * verdict.
 */
function describeCause(entryPoint, cause) {
  if (cause === 'build-failed')
    return {
      headline: `${entryPoint} did NOT run: the \`build\` stage FAILED earlier in this run.`,
      subtitle: [
        'This is NOT a second verdict — the `build` failure reported above IS the verdict. The build',
        'output this stage reads was never produced, so anything it reported would describe the',
        'missing output rather than your change.',
      ],
      remedy: ['  Fix the `build` failure reported above, then re-run the gate.'],
    };
  return {
    headline: `${entryPoint} did NOT run: this tree is missing a verification prerequisite.`,
    subtitle: [
      'This is NOT a verdict on your change — nothing about the diff has been measured yet.',
    ],
    remedy: null,
  };
}

/**
 * The message. It leads with "not a verdict on your change" on purpose: the failure mode this closes
 * is an agent spending real effort proving a red was not its own, four times over in one day.
 */
export function formatPrerequisiteFailure(entryPoint, state, cause = 'unprepared') {
  if (!PREREQUISITE_CAUSES.includes(cause))
    throw new Error(
      `unknown prerequisite cause \`${cause}\` — the message must state a cause it can explain, not fall back to a generic one.`,
    );
  const copy = describeCause(entryPoint, cause);
  return [
    '',
    RULE,
    copy.headline,
    ...copy.subtitle,
    '',
    describeLocation(state.tree),
    '',
    ...describeMissing(state),
    '',
    ...(copy.remedy ?? [
      '  Run this IN THIS TREE, then re-run the gate:',
      ...remedyCommands(state.missing).map((command) => `    ${command}`),
    ]),
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

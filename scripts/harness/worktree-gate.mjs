#!/usr/bin/env node

/**
 * The mechanical half of the two worktree gates.
 *
 * ## Why this exists
 *
 * Working in git worktrees produced the same three accidents repeatedly, and every one of them was
 * silent at the moment it happened:
 *
 *  1. **Ambient git environment.** Git hooks export `GIT_DIR`, and it outranks the working
 *     directory. A process that inherited it wrote to the repository it was invoked FROM rather than
 *     the one it was standing in — which is how a shared branch was overwritten with fixture commits
 *     more than once. The command looked local and was not.
 *  2. **A branch another worktree already holds.** `git checkout` refuses it, and in a compound
 *     command the REST of the line still runs — against whatever branch is actually checked out. A
 *     `reset --hard` meant for one branch landed on another.
 *  3. **Build output from a different branch.** `dist/` is untracked, so switching branches leaves
 *     artifacts built from other source in place. Tests that read the built bundle then judge the
 *     wrong tree, and the failure surfaces minutes later inside a push hook rather than at the
 *     switch.
 *
 * None of these is a judgement call, so none of them should depend on someone remembering. This
 * script is what the gates actually run; the agents around it judge what a finding MEANS for the
 * work at hand.
 *
 * ## The two phases
 *
 * `--phase before` — asked before work starts in a worktree. Refuses a start that is already unsafe.
 * `--phase after` — asked before the work leaves the worktree (push, PR, merge). Refuses a handoff
 * whose result cannot be trusted.
 *
 * ## Which way its enumeration fails
 *
 * fail-direction: refuse — every check answers a question with a KNOWN safe answer, and anything
 * else, including "could not determine", is a finding. The git-environment check in particular is a
 * denylist of variable names, so a variable git adds later goes unnoticed; that gap is stated here
 * rather than hidden, and the branch/worktree check below catches the consequence a missed variable
 * would produce. What this must never do is pass because a check could not run.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Ambient git variables that redirect where a git command reads and writes.
 *
 * The same list the test harness deletes before running. Kept in sync by intent, not by import: this
 * script must run with no build step and no workspace resolution, because one of the states it
 * exists to diagnose is a worktree whose dependencies are not installed.
 */
const GIT_AMBIENT_ENV = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CEILING_DIRECTORIES',
  'GIT_PREFIX',
  'GIT_NAMESPACE',
];

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** Every worktree of this repository, with the branch each one holds. */
export function listWorktrees(cwd = process.cwd()) {
  const raw = git(['worktree', 'list', '--porcelain'], cwd);
  const worktrees = [];
  let current = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length), branch: null, detached: false };
      worktrees.push(current);
    } else if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch refs/heads/'.length);
    } else if (line === 'detached' && current) {
      current.detached = true;
    }
  }
  return worktrees;
}

/** Variables that would send a git command somewhere other than where it appears to go. */
export function ambientGitEnvFindings(env = process.env) {
  return GIT_AMBIENT_ENV.filter((name) => env[name] !== undefined && env[name] !== '').map(
    (name) => ({
      check: 'ambient-git-env',
      detail:
        `\`${name}\` is set in this environment. It outranks the working directory, so a git ` +
        `command run here can read and write a DIFFERENT repository than the one you are standing ` +
        `in. Unset it — this is how a shared branch was overwritten from inside a worktree.`,
    }),
  );
}

/** A branch held by a worktree other than this one cannot be checked out here. */
export function branchHeldElsewhereFindings(branch, cwd = process.cwd()) {
  if (!branch) return [];
  const here = path.resolve(cwd);
  return listWorktrees(cwd)
    .filter((worktree) => worktree.branch === branch && path.resolve(worktree.path) !== here)
    .map((worktree) => ({
      check: 'branch-held-elsewhere',
      detail:
        `\`${branch}\` is checked out in ${worktree.path}. A checkout here FAILS — and in a ` +
        `compound command the rest of the line still runs, against whatever branch is actually ` +
        `checked out. Work in that worktree, or pick another branch.`,
    }));
}

/** A worktree whose dependencies were never installed cannot run anything it is asked to verify. */
export function dependenciesInstalledFindings(cwd = process.cwd()) {
  if (existsSync(path.join(cwd, 'node_modules'))) return [];
  return [
    {
      check: 'dependencies-missing',
      detail:
        'No `node_modules` in this worktree. A fresh worktree shares the repository but not the ' +
        'install, so every test and build here fails on a missing dependency rather than on the ' +
        'code. Run the install once before starting.',
    },
  ];
}

/** The newest modification time under a directory, or null when it has no files. */
function newestMtime(dir, skip = new Set(['node_modules', '.git'])) {
  let newest = null;
  const walk = (current) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      try {
        const mtime = statSync(full).mtimeMs;
        if (newest === null || mtime > newest) newest = mtime;
      } catch {
        // The file went away between listing and stat — it cannot be the newest thing here.
      }
    }
  };
  walk(dir);
  return newest;
}

/**
 * Build output older than the source beside it.
 *
 * Only packages that HAVE been built are examined: an unbuilt package is not stale, it is unbuilt,
 * and treating the two the same would make this fire on every clean worktree and be turned off.
 */
export function staleBuildFindings(cwd = process.cwd()) {
  const findings = [];
  for (const group of ['packages', 'apps']) {
    const groupDir = path.join(cwd, group);
    if (!existsSync(groupDir)) continue;
    for (const name of readdirSync(groupDir)) {
      const dist = path.join(groupDir, name, 'dist');
      const src = path.join(groupDir, name, 'src');
      if (!existsSync(dist) || !existsSync(src)) continue;
      const builtAt = newestMtime(dist);
      const changedAt = newestMtime(src);
      if (builtAt === null || changedAt === null) continue;
      if (changedAt > builtAt) {
        findings.push({
          check: 'stale-build-output',
          detail:
            `${group}/${name}: \`src\` is newer than \`dist\`. \`dist\` is untracked, so switching ` +
            `branches leaves artifacts built from OTHER source in place — a test that reads the ` +
            `built bundle then judges the wrong tree. Rebuild before handing this off.`,
        });
      }
    }
  }
  return findings;
}

/** The branch this worktree is actually on is the branch the work claims. */
export function headMatchesFindings(branch, cwd = process.cwd()) {
  if (!branch) return [];
  let head;
  try {
    head = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  } catch {
    return [
      {
        check: 'head-unreadable',
        detail: 'Could not read HEAD. A worktree whose HEAD cannot be read cannot be handed off.',
      },
    ];
  }
  if (head === branch) return [];
  return [
    {
      check: 'head-mismatch',
      detail:
        `This worktree is on \`${head}\`, not \`${branch}\`. Whatever was verified was verified ` +
        `against a different branch than the one being handed off.`,
    },
  ];
}

export function runGate(phase, branch, cwd = process.cwd()) {
  if (phase === 'before') {
    return [
      ...ambientGitEnvFindings(),
      ...branchHeldElsewhereFindings(branch, cwd),
      ...dependenciesInstalledFindings(cwd),
    ];
  }
  return [
    ...ambientGitEnvFindings(),
    ...headMatchesFindings(branch, cwd),
    ...staleBuildFindings(cwd),
  ];
}

function takeOption(argv, name) {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

function main() {
  const argv = process.argv.slice(2);
  const phase = takeOption(argv, '--phase');
  const branch = takeOption(argv, '--branch');

  if (phase !== 'before' && phase !== 'after') {
    console.error('worktree-gate: --phase must be `before` or `after`.');
    console.error('  usage: worktree-gate.mjs --phase before|after [--branch <name>]');
    process.exit(2);
  }

  // The environment check runs BEFORE any git command, and this ordering is the finding itself.
  // With `GIT_DIR` pointing somewhere else, `git worktree list` does not merely give a wrong answer —
  // it throws, and the first version of this script died with a stack trace instead of naming the
  // problem. Every git call below is only meaningful once this has passed, so nothing may run first.
  const ambient = ambientGitEnvFindings();
  if (ambient.length > 0) {
    console.error(`\nworktree-gate (${phase}) FAILED:`);
    for (const finding of ambient) {
      console.error(`  [${finding.check}] ${finding.detail}`);
    }
    console.error(
      '  Nothing else was checked: with these set, every git command below would answer about ' +
        'another repository.',
    );
    process.exit(1);
  }

  const worktrees = listWorktrees();
  // Traffic control: who holds what, printed whether or not anything is wrong, because the answer to
  // "can I work here" usually depends on what else is open.
  console.log(`::examined:: ${worktrees.length} worktree(s)`);
  for (const worktree of worktrees) {
    console.log(
      `  ${worktree.detached ? '(detached)' : (worktree.branch ?? '(none)')}  ${worktree.path}`,
    );
  }

  const findings = runGate(phase, branch);
  if (findings.length === 0) {
    console.log(`worktree-gate (${phase}) passed.`);
    process.exit(0);
  }
  console.error(`\nworktree-gate (${phase}) FAILED:`);
  for (const finding of findings) {
    console.error(`  [${finding.check}] ${finding.detail}`);
  }
  process.exit(1);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}

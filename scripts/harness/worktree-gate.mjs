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
 *  3. **Build output from a different branch.** Build output is untracked, so switching branches leaves
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
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// A sibling harness module that imports nothing but node builtins, so this script still runs in a
// worktree whose dependencies were never installed — one of the states it exists to diagnose.
import { listWorkspacePackageDirs } from './workspace-packages.mjs';

/**
 * Ambient git variables that redirect where a git command reads and writes.
 *
 * Loaded from `git-ambient-env.json`, which OWNS the list. Three copies of it existed — here, in the
 * test harness, and in the hook — and review found them already disagreeing: seven variables in one,
 * nine in another. A second spelling of "what redirects git" is a second answer waiting to disagree,
 * and this one had.
 *
 * Read with `readFileSync` rather than an import so this script keeps running in a worktree whose
 * dependencies were never installed — which is one of the states it exists to diagnose.
 */
const GIT_AMBIENT_ENV = JSON.parse(
  readFileSync(path.join(import.meta.dirname, 'git-ambient-env.json'), 'utf8'),
).variables;

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

/**
 * Variables that would send a git command somewhere other than where it appears to go.
 *
 * PRESENCE, not "does it name another repository" — which is a deliberate difference from the hook,
 * and review was right to ask about it.
 *
 * The hook judges ONE command as it is issued, thousands of times a session, and git exports these
 * into every hook it runs; refusing on presence there would fire on the ordinary case constantly.
 * This gate is asked ONCE, before work begins, and its answer is "is it safe to start here" — a
 * session that starts with any of these inherited is one where every later judgement is made against
 * a different repository than the reader thinks. The cost of being wrong differs by orders of
 * magnitude in the two places, so the thresholds differ too.
 *
 * What must NOT differ is the LIST, and it does not: both read `git-ambient-env.json`.
 */
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
  let worktrees;
  try {
    worktrees = listWorktrees(cwd);
  } catch {
    // `headMatchesFindings` below already answers this way, and this function did not — an
    // asymmetry review found. A directory that is not a work tree is the state an ambient `GIT_DIR`
    // naming a repository that no longer exists produces, and it came out of the gate as a Node
    // stack trace rather than as the refusal the gate is supposed to speak in.
    //
    // Could-not-determine is a finding here, per this file's stated fail-direction.
    return [
      {
        check: 'worktrees-unreadable',
        detail:
          'Could not list the worktrees of this repository. Nothing here can be shown to be safe ' +
          'to check out, so this is a refusal rather than a pass — check that this directory is ' +
          'inside a git work tree and that no ambient git variable is redirecting it.',
      },
    ];
  }
  return worktrees
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
 * Where a build in this repository lands, and where the source that produced it lives.
 *
 * Both are lists because this repository does not have one answer for either, and the first version
 * of this check assumed it did: it looked only for `<name>/dist` beside `<name>/src`. Review
 * measured what that walked past — `next build` writes `.next` (and `out`, for the exported docs
 * site), so `apps/agent-web`, `apps/docs`, `apps/starter-nextjs` and `apps/www` were enumerated and
 * then silently examined for nothing, while `apps/starter-nextjs` keeps its source in `app/` and so
 * failed the source test as well.
 *
 * A name absent from these lists reads as "not built", which is the correct answer for a package
 * nobody built and a silent one for a package built somewhere unlisted. That is why `main()` prints
 * the built outputs it examined: the difference between "clean" and "not looked at" has to be
 * visible in the gate's own output, not inferred from this comment.
 */
const BUILD_OUTPUTS = ['dist', '.next', 'out'];
const SOURCE_DIRS = ['src', 'app', 'pages'];

/**
 * Every build output present in this tree, with the source directories it should be newer than.
 *
 * Exported so the gate can PRINT what it examined. `listWorkspacePackageDirs` is the workspace's own
 * enumeration rather than a `readdirSync` of `packages` and `apps` — that hand-rolled walk is the
 * one that misses the declared nested group `packages/dag-nodes/*`, which is exactly the class of
 * silent under-coverage this function was rewritten to remove.
 */
export function builtOutputDirs(cwd = process.cwd()) {
  const built = [];
  for (const packageDir of listWorkspacePackageDirs(cwd)) {
    const sources = SOURCE_DIRS.map((name) => path.join(packageDir, name)).filter((dir) =>
      existsSync(dir),
    );
    if (sources.length === 0) continue;
    for (const output of BUILD_OUTPUTS) {
      const dir = path.join(packageDir, output);
      if (!existsSync(dir)) continue;
      built.push({
        dir,
        output,
        sources,
        label: `${path.relative(cwd, packageDir).split(path.sep).join('/')}/${output}`,
      });
    }
  }
  return built;
}

/**
 * Build output older than the source beside it.
 *
 * Only outputs that EXIST are examined: an unbuilt package is not stale, it is unbuilt, and treating
 * the two the same would make this fire on every clean worktree and be turned off.
 *
 * Each output is judged on its own rather than folded together, because a package can carry two of
 * them — `apps/docs` writes both `.next` and `out` — and a fresh one beside a stale one is still a
 * stale artifact a test can read.
 */
export function staleBuildFindings(cwd = process.cwd()) {
  const findings = [];
  for (const built of builtOutputDirs(cwd)) {
    const builtAt = newestMtime(built.dir);
    const changed = built.sources.map((dir) => newestMtime(dir)).filter((at) => at !== null);
    if (builtAt === null || changed.length === 0) continue;
    const changedAt = Math.max(...changed);
    if (changedAt <= builtAt) continue;
    findings.push({
      check: 'stale-build-output',
      detail:
        `${built.label}: the source beside it is newer. Build output is untracked, so switching ` +
        `branches leaves artifacts built from OTHER source in place — a test that reads the ` +
        `built bundle then judges the wrong tree. Rebuild before handing this off.`,
    });
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
  // The ordering stated at the top of this file, enforced HERE rather than only in `main()`.
  //
  // The first version spread every check into one array literal, and an array literal evaluates all
  // of its elements: with `GIT_DIR` set, the git calls beside the ambient check still ran, against
  // the repository that variable names. `main()` guarded the ordering separately, so the CLI was
  // safe and this — the exported, tested, importable function — was not. Review found the gap, and
  // "the wrong repository answered" is the accident class this whole file was written for.
  const ambient = ambientGitEnvFindings();
  if (ambient.length > 0) return ambient;
  if (phase === 'before') {
    return [...branchHeldElsewhereFindings(branch, cwd), ...dependenciesInstalledFindings(cwd)];
  }
  return [...headMatchesFindings(branch, cwd), ...staleBuildFindings(cwd)];
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
    console.error('  usage: worktree-gate.mjs --phase before|after --branch <name>');
    process.exit(2);
  }

  // `--branch` is REQUIRED, and the usage above stopped calling it optional. Review found what the
  // optional spelling cost: `branchHeldElsewhereFindings` and `headMatchesFindings` both return `[]`
  // immediately when `branch` is falsy, so running without it skipped at least one of the two core
  // checks in each phase and still printed `worktree-gate (...) passed.`
  //
  // That is the silent green this gate exists to remove — its own stated purpose is that none of
  // these checks "should depend on someone remembering". A gate whose coverage depends on an
  // optional argument depends on exactly that.
  if (branch === undefined || branch === '' || branch.startsWith('--')) {
    console.error('worktree-gate: --branch <name> is required.');
    console.error(
      '  Without it, the branch-held-elsewhere and HEAD-matches checks examine nothing',
    );
    console.error('  and this gate would report a pass it did not compute.');
    console.error('  usage: worktree-gate.mjs --phase before|after --branch <name>');
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

  // Traffic control: who holds what, printed whether or not anything is wrong, because the answer to
  // "can I work here" usually depends on what else is open.
  //
  // Guarded for the same reason `branchHeldElsewhereFindings` is, and review found that fix helping
  // only the library function: this line runs FIRST, so a directory that is not a readable work tree
  // — the stale-worktree case the gate is written for — died here with a Node stack trace before
  // any check ran. A stack trace does not read as the refusal the rest of this script speaks in, and
  // this file's own rule is that it must never pass because a check could not run. It does not pass;
  // it just failed unintelligibly.
  try {
    const worktrees = listWorktrees();
    console.log(`::examined:: ${worktrees.length} worktree(s)`);
    for (const worktree of worktrees) {
      console.log(
        `  ${worktree.detached ? '(detached)' : (worktree.branch ?? '(none)')}  ${worktree.path}`,
      );
    }
  } catch {
    // Not fatal by itself — the checks below answer for themselves, and the branch check reports its
    // own `worktrees-unreadable` finding for this same condition. What is printed here is context.
    console.error('[worktree-gate] Could not list the worktrees of this repository.');
    console.error('  The traffic table below is missing, not empty. The checks still ran.');
  }

  if (phase === 'after') {
    // What the stale-build check actually looked at. A build directory this repository does not
    // name reads as "not built", and without this line that is indistinguishable in the output from
    // "built and current" — which is how every Next.js app was walked past in silence until review
    // measured it.
    const built = builtOutputDirs();
    console.log(`::examined:: ${built.length} built output(s)`);
    for (const output of built) console.log(`  ${output.label}`);
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

/**
 * INFRA-121 (issue #1908) — the single owner of "which files does a scan judge".
 *
 * A harness scan used to decide for itself. Eight enumerated through `git ls-files`, so their
 * coverage depended on the git index; the rest read the filesystem, so theirs did not. Nothing owned
 * the choice, nothing stated it, and no scan reported what its enumeration left out.
 *
 * ## The false green, measured
 *
 * Review of pull request #1886, round four. A newly written task document carried a citation
 * `reference-kind-qualified` refuses:
 *
 * | when | verdict |
 * | --- | --- |
 * | before `git add` | **passed**, printing `::examined:: 2936 tracked document(s)` |
 * | after staging | failed, naming that file and that line |
 *
 * The suite ran, declared its size, and reported success on a tree whose newest file it could not
 * see — at exactly the moment a writer checks their work. A human found it a review round later.
 *
 * That is worse than a scan with no coverage. A missing scan is visibly missing; this one printed a
 * number and a pass. `enforcement-architecture.md` says silence is not success, and a size that is
 * silently conditional on the index is the same defect wearing a measurement.
 *
 * ## What this module does
 *
 * Enumerates tracked files AND untracked files git does not ignore, because both are part of the
 * tree the author is asking about. An ignored file stays out — that is a deliberate exclusion the
 * repository already declared in `.gitignore`, not an accident of when someone last ran `git add`.
 *
 * What it leaves out after that is only what `.gitignore` already declares — an exclusion the
 * repository states in one place, for every reader, rather than one a scan discovers by accident of
 * when someone last ran `git add`. Measured before deciding not to report it per-run: the ignored set
 * for `*.md` alone is 3,021 paths, almost all under `node_modules`. A disclosure that prints a
 * four-digit number every run is one readers learn to skip, which is how a real one would be missed.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { envWithoutGitVars, resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

function gitLines(args, cwd = WORKSPACE_ROOT) {
  const out = execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    // Strip hook-inherited GIT_DIR/GIT_INDEX_FILE: under a git hook they redirect this call to the
    // hook's repository regardless of `cwd`, listing the WRONG repo. `check-done-evidence` learned
    // this the hard way and its comment is the reason this is here rather than in one caller.
    env: envWithoutGitVars(),
  });
  return out.split('\0').filter((entry) => entry.length > 0);
}

let lastEnumerated = 0;

/**
 * How many paths the last enumeration returned.
 *
 * RESET by each enumeration rather than accumulated: a number that grows across calls reads as a
 * growing subject, which is the one way a declared measurement can be wrong while every finding it
 * reports is right.
 */
export function examinedFileCount() {
  return lastEnumerated;
}

/**
 * Every file in the tree a scan should judge, for the given pathspecs.
 *
 * Named `collect…` to match the harness finder convention, so `measurement-provenance` can pair it
 * with `examinedFileCount` and a test can assert the size this module reports rather than believe it.
 *
 * `--others --exclude-standard` is the half that fixes the incident: a file written and not yet
 * staged is part of the tree its author is asking about, and a scan that cannot see it answers a
 * question nobody asked.
 */
export function collectFiles(
  pathspecs = [],
  { includeUntracked = true, cwd = WORKSPACE_ROOT, run = gitLines } = {},
) {
  const tracked = run(['ls-files', '-z', ...pathspecs], cwd);
  if (!includeUntracked) {
    lastEnumerated = tracked.length;
    return tracked;
  }
  const untracked = run(['ls-files', '-z', '--others', '--exclude-standard', ...pathspecs], cwd);
  const all = [...new Set([...tracked, ...untracked])].sort();
  lastEnumerated = all.length;
  return all;
}

/**
 * The name the call sites read as.
 *
 * Kept because `collectFiles` says what the harness's provenance rule needs to hear and
 * `enumerateFiles` says what a caller is doing. One function, two readers, no second implementation.
 */
export const enumerateFiles = collectFiles;

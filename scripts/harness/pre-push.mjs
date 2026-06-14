import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveGitBaseRef, WORKSPACE_ROOT } from './shared.mjs';
import {
  decidePrePushVerification,
  formatLockfileFailureMessage,
  parsePrePushUpdates,
} from './pre-push-updates.mjs';

function run(command, args) {
  const rendered = [command, ...args].join(' ');
  process.stdout.write(`> ${rendered}\n`);

  const result = spawnSync(command, args, {
    cwd: WORKSPACE_ROOT,
    stdio: 'inherit',
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runGitQuiet(args) {
  return (
    spawnSync('git', args, {
      cwd: WORKSPACE_ROOT,
      stdio: 'ignore',
      encoding: 'utf8',
    }).status === 0
  );
}

function assertNoActiveWorktrees() {
  const result = spawnSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
  });
  const entries = (result.stdout ?? '').trim().split('\n\n').filter(Boolean);
  if (entries.length > 1) {
    process.stderr.write(
      '\n[BANNED] Active git worktree(s) detected — push blocked.\n' +
        'git worktree is absolutely prohibited in this repo.\n' +
        'Remove all extra worktrees before pushing:\n' +
        '  git worktree list\n' +
        '  git worktree remove -f -f <path>\n\n',
    );
    process.exit(1);
  }
}

function assertLockfileConsistency() {
  // pnpm 8's `--lockfile-only` rewrites pnpm-lock.yaml even with
  // --frozen-lockfile when the check passes, so the validation runs in a
  // throwaway copy of the manifests + lockfile (zero working-tree side effects).
  const stage = mkdtempSync(path.join(tmpdir(), 'robota-lockfile-check-'));
  try {
    const manifests = ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', '.npmrc'];
    for (const file of manifests) {
      const source = path.join(WORKSPACE_ROOT, file);
      if (existsSync(source)) copyFileSync(source, path.join(stage, file));
    }
    for (const family of ['packages', 'apps']) {
      const familyDir = path.join(WORKSPACE_ROOT, family);
      if (!existsSync(familyDir)) continue;
      for (const entry of readdirSync(familyDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const manifest = path.join(familyDir, entry.name, 'package.json');
        if (!existsSync(manifest)) continue;
        const targetDir = path.join(stage, family, entry.name);
        mkdirSync(targetDir, { recursive: true });
        copyFileSync(manifest, path.join(targetDir, 'package.json'));
      }
    }
    const result = spawnSync('pnpm', ['install', '--frozen-lockfile', '--lockfile-only'], {
      cwd: stage,
      stdio: 'ignore',
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      process.stderr.write(formatLockfileFailureMessage());
      process.exit(1);
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

// Auto-generated evals artifacts regenerate every session and would otherwise
// block every push, forcing a manual `git checkout -- .agents/evals/lessons/`.
// They are tracked deliverables (not gitignore candidates), so we tolerate them
// here: a push is allowed when the ONLY dirty files are these. We never delete
// them — we just don't block on their churn.
const EVALS_AUTO_CHURN = new Set([
  '.agents/evals/lessons/auto-lessons.md',
  '.agents/evals/lessons/weekly-digest.md',
]);

function isEvalsAutoChurn(statusLine) {
  return EVALS_AUTO_CHURN.has(statusLine.slice(3).trim());
}

function assertCleanWorkingTree() {
  const result = spawnSync('git', ['status', '--porcelain'], {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
  });
  const lines = (result.stdout ?? '')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean);
  // XY status codes: first char = staged, second char = unstaged.
  // '??' = untracked. We block on any modified/staged file but not on
  // untracked files (those are handled by .gitignore discipline).
  const tracked = lines.filter((l) => l.slice(0, 2) !== '??');
  const tolerated = tracked.filter(isEvalsAutoChurn);
  const dirty = tracked.filter((l) => !isEvalsAutoChurn(l));
  if (tolerated.length > 0 && dirty.length === 0) {
    process.stdout.write(
      '▶ tolerating auto-generated evals churn (not blocking push):\n' +
        tolerated.map((l) => `  ${l}`).join('\n') +
        '\n',
    );
  }
  if (dirty.length > 0) {
    process.stderr.write(
      '\n[BLOCKED] Uncommitted changes detected — push blocked.\n' +
        'Commit or discard all modified/staged files before pushing:\n\n' +
        dirty.map((l) => `  ${l}`).join('\n') +
        '\n\nSee .agents/rules/git-branch.md "Clean Working Tree" rule.\n\n',
    );
    process.exit(1);
  }
}

function hasWorkingTreeChanges() {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return true;
  }
  return result.stdout.trim().length > 0;
}

function readPrePushInput() {
  if (process.stdin.isTTY) {
    return '';
  }

  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function resolvePrePushMode(value) {
  const mode = value?.trim() || 'fast';
  if (mode !== 'fast' && mode !== 'full') {
    throw new Error('HARNESS_PRE_PUSH_MODE must be one of: fast, full');
  }
  return mode;
}

assertNoActiveWorktrees();
assertCleanWorkingTree();
assertLockfileConsistency();

const baseRef = resolveGitBaseRef(process.env.HARNESS_BASE_REF ?? null);
const baseArgs = baseRef ? ['--base-ref', baseRef] : [];
const prePushMode = resolvePrePushMode(process.env.HARNESS_PRE_PUSH_MODE);
const scopeExpansionArgs = prePushMode === 'fast' ? ['--skip-dependent-scopes'] : [];
const updates = parsePrePushUpdates(readPrePushInput());
const treeMatchesBase =
  baseRef && !hasWorkingTreeChanges()
    ? runGitQuiet(['diff', '--quiet', baseRef, 'HEAD', '--'])
    : false;
const prePushDecision = decidePrePushVerification({
  updates,
  baseRef,
  treeMatchesBase,
});

if (!prePushDecision.shouldRun) {
  process.stdout.write(`▶ scoped pre-push verification skipped: ${prePushDecision.reason}\n`);
  process.exit(0);
}

process.stdout.write(`▶ scoped pre-push verification (${prePushMode})\n`);
if (baseRef) {
  process.stdout.write(`base: ${baseRef}\n`);
} else {
  process.stdout.write('base: unresolved; using working-tree changes only\n');
}

if (prePushMode === 'fast') {
  process.stdout.write('dependent scope expansion: skipped; use HARNESS_PRE_PUSH_MODE=full\n');
}

run('pnpm', ['harness:plan', '--', ...baseArgs, ...scopeExpansionArgs]);
run('pnpm', ['harness:verify', '--', ...baseArgs, ...scopeExpansionArgs, '--skip-record-check']);

process.stdout.write('\n▶ CLI smoke check (cli:dev --version)\n');
run('pnpm', ['cli:dev', '--version']);

process.stdout.write('\nRelease-grade verification remains explicit:\n');
process.stdout.write('  HARNESS_PRE_PUSH_MODE=full pnpm harness:pre-push\n');
process.stdout.write('  pnpm harness:verify:release\n');

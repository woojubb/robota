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
import { checkTreePrerequisites } from './tree-prerequisites.mjs';

/**
 * The commands the REQUIRED `scans` context runs, mirrored locally.
 *
 * INFRA-069. `scans` is required on `protect-develop`, and this gate ran none of it: measured, a
 * change under a package's `src` selected ZERO of the ~99 scans, so the first thing that ever examined it
 * was CI. The declared local mirror, `verify-like-ci`, was invoked by nothing at all.
 *
 * The item framed the open question as what the local gate should COST, on the reasoning that a slow
 * pre-push gets bypassed with `--no-verify`. Measured instead of debated: the scan suite is 6s and
 * the harness test suite 54s, against a CI round trip of five to six minutes. At a minute there is
 * nothing to trade off, so the whole suite runs and no subset had to be invented.
 *
 * FLAGS INCLUDED DELIBERATELY. `--skip dist --skip build-contracts` is what the workflow passes;
 * running MORE here than CI does would refuse pushes CI would accept, which is property 4 —
 * firing on correct work — and the fastest way to have a gate turned off. `pre-push-mirrors-ci-scans.test.mjs`
 * reads both sides so the two cannot drift silently.
 */
export const CI_SCANS_JOB_MIRROR = [
  ['pnpm', ['harness:test']],
  ['pnpm', ['harness:scan', '--', '--skip', 'dist', '--skip', 'build-contracts']],
];

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

/**
 * Worktrees are ALLOWED (they power parallel sub-agent work — see git-branch.md § Git Worktree). This is the
 * non-blocking hygiene safeguard that replaces the old ban: prune administrative junk, then WARN about
 * locked/stale extra worktrees so left-behind ones surface — it never blocks the push.
 */
function pruneAndWarnStaleWorktrees() {
  spawnSync('git', ['worktree', 'prune'], { cwd: WORKSPACE_ROOT, encoding: 'utf8' });
  const result = spawnSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
  });
  const entries = (result.stdout ?? '').trim().split('\n\n').filter(Boolean);
  const extra = entries.slice(1); // entry[0] is the main clone
  const locked = extra.filter((e) => /\nlocked/.test(`\n${e}`));
  if (locked.length > 0) {
    const paths = locked.map((e) => (e.match(/^worktree (.+)$/m) ?? [])[1] ?? '?').join('\n  ');
    process.stderr.write(
      `\n[worktree hygiene] ${locked.length} LOCKED worktree(s) present (not blocking):\n  ${paths}\n` +
        'If these are stale agent leftovers, clean up: git worktree remove <path> && git worktree prune\n\n',
    );
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

/**
 * HARNESS-058: this gate runs `pnpm harness:verify` and then `pnpm cli:dev --version`, and both read
 * build output it never produces. In a fresh worktree the smoke check died on
 * `Cannot find module '…/packages/agent-command-workflows/node_modules/@robota-sdk/dag-core/dist/node/index.js'`
 * — a message that reads like a broken import in the change being pushed. It is not a verdict on the
 * change; it is an unprepared tree, and it says so now. The push is still blocked: naming the
 * prerequisite is what changed, not whether the gate holds.
 *
 * Called only from the verifying branch of `runPrePushGate` — see the ordering note there.
 */
function assertTreePrerequisites() {
  const result = checkTreePrerequisites('the pre-push gate', WORKSPACE_ROOT);
  if (result.ok) return;
  process.stderr.write(result.message);
  process.exit(1);
}

/**
 * The gate's step ORDER, stated once and exported so a test can assert the sequence itself.
 *
 * HARNESS-058, second face. `assertTreePrerequisites` used to run third — before
 * `decidePrePushVerification` had decided whether anything would be verified at all. But two kinds
 * of push run NO verification: a delete-only push, and a re-push whose tree has no content delta
 * from its base. Neither reads `node_modules` or `dist`, and both were refused in a fresh worktree,
 * demanding `pnpm install && pnpm build` for a push with nothing to check — in exactly the
 * parallel-subagent-in-a-fresh-worktree configuration this item exists to serve.
 *
 * A prerequisite is owed only by work that is actually going to happen, so it is asserted AFTER the
 * decision to verify. The steps are INJECTED rather than called directly because the defect was an
 * ordering defect: a test asserting only "a delete-only push is allowed" would go green again if the
 * assertion moved back ahead of the decision for some unrelated reason.
 */
export function runPrePushGate(steps) {
  steps.pruneAndWarnStaleWorktrees();
  steps.assertCleanWorkingTree();
  steps.assertLockfileConsistency();

  const decision = steps.decideVerification();
  if (!decision.shouldRun) {
    steps.reportSkipped(decision.reason);
    return { verified: false, reason: decision.reason };
  }

  // Everything below this line reads build output and installed binaries; nothing above it does.
  steps.assertTreePrerequisites();
  steps.runVerification();
  return { verified: true, reason: null };
}

/** The real steps, bound to this process's environment and working tree. */
function createPrePushSteps() {
  const baseRef = resolveGitBaseRef(process.env.HARNESS_BASE_REF ?? null);
  const baseArgs = baseRef ? ['--base-ref', baseRef] : [];
  const prePushMode = resolvePrePushMode(process.env.HARNESS_PRE_PUSH_MODE);
  const scopeExpansionArgs = prePushMode === 'fast' ? ['--skip-dependent-scopes'] : [];

  return {
    pruneAndWarnStaleWorktrees,
    assertCleanWorkingTree,
    assertLockfileConsistency,
    assertTreePrerequisites,

    decideVerification: () =>
      decidePrePushVerification({
        updates: parsePrePushUpdates(readPrePushInput()),
        baseRef,
        treeMatchesBase:
          baseRef && !hasWorkingTreeChanges()
            ? runGitQuiet(['diff', '--quiet', baseRef, 'HEAD', '--'])
            : false,
      }),

    reportSkipped: (reason) =>
      process.stdout.write(`▶ scoped pre-push verification skipped: ${reason}\n`),

    runVerification: () => {
      process.stdout.write(`▶ scoped pre-push verification (${prePushMode})\n`);
      process.stdout.write(
        baseRef ? `base: ${baseRef}\n` : 'base: unresolved; using working-tree changes only\n',
      );
      if (prePushMode === 'fast') {
        process.stdout.write(
          'dependent scope expansion: skipped; use HARNESS_PRE_PUSH_MODE=full\n',
        );
      }

      run('pnpm', ['harness:plan', '--', ...baseArgs, ...scopeExpansionArgs]);
      run('pnpm', [
        'harness:verify',
        '--',
        ...baseArgs,
        ...scopeExpansionArgs,
        '--skip-record-check',
      ]);

      process.stdout.write('\n▶ the required `scans` context, run locally (INFRA-069)\n');
      for (const [command, args] of CI_SCANS_JOB_MIRROR) run(command, args);

      process.stdout.write('\n▶ CLI smoke check (cli:dev --version)\n');
      run('pnpm', ['cli:dev', '--version']);

      process.stdout.write('\nRelease-grade verification remains explicit:\n');
      process.stdout.write('  HARNESS_PRE_PUSH_MODE=full pnpm harness:pre-push\n');
      process.stdout.write('  pnpm harness:verify:release\n');
    },
  };
}

// Guarded so a test can import `runPrePushGate` without running the gate against its own checkout.
if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  runPrePushGate(createPrePushSteps());
}

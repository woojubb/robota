#!/usr/bin/env node

/**
 * Promotion-ancestry gate (INFRA-051).
 *
 * `main` and `develop` are synced by two merges, and BOTH used to be squashed. A squash copies
 * content across but records NO ancestry link: after `main -> develop` squash-merged as `bc0ee64ff`
 * (single parent), `git merge-base --is-ancestor origin/main origin/develop` still failed, so the
 * next `develop -> main` promotion re-computed against the OLD merge base and re-conflicted on
 * exactly the five `package.json` files plus `pnpm-lock.yaml` the back-merge had just reconciled
 * (#1415 → #1413, 2026-07-26). The content was synced; the ancestry was not.
 *
 * That cost is not the conflict — it is that a human must RE-DERIVE the resolution every cycle, and
 * both wholesale directions are wrong: resolving toward `main` reverts develop's dependency patch
 * bumps, resolving toward `develop` un-archives backlog items and drops changesets. A resolution
 * hand-derived every cycle will eventually be got wrong.
 *
 * This scan is the mechanical floor. It runs on a PR whose base is `main` — BEFORE the promotion
 * lands — and asserts three things about the promotion head:
 *
 *   A1  `origin/main` is an ancestor of the head.  The promotion CARRIES main's ancestry, so the
 *       merge introduces no content and the next merge base is develop's own tip. This is exactly
 *       the property a squashed back-merge destroys — the measured red.
 *   A2  The head adds no NON-MERGE commit outside `origin/develop`'s ancestry (beyond the frozen
 *       adoption baseline). Catches a PREVIOUS promotion that was squashed: its squash commit is a
 *       non-merge commit on `main` that `develop` has never seen.
 *   A3  The head's tree equals the tree of the develop commit it was cut from. Turns "the merge of
 *       main is clean by construction" from an assumption into an assertion — it is RED for an evil
 *       merge, a `hotfix/*` that landed content on `main`, or any direct push to `main`, none of
 *       which A2 can see (`--no-merges` cannot observe content a merge commit introduced).
 *
 * A1/A3 MUST be evaluated on `github.event.pull_request.head.sha`, never `HEAD`. On a
 * `pull_request` event `HEAD` is GitHub's synthetic `refs/pull/N/merge`, whose FIRST parent is the
 * base — `merge-base --is-ancestor origin/main HEAD` is VACUOUSLY true there, and the gate would
 * pass on the very state it exists to reject. `ci.yml`'s commitlint job documents the same trap.
 *
 * Outside a promotion context the scan prints an explicit SKIP line with the reason and exits 0 —
 * never a silent no-op (INFRA-050's incident was a scan reporting SKIPPED while the suite exited 0).
 *
 * Exit code 0 = the promotion preserves ancestry, 1 = it does not.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

/**
 * Frozen adoption baseline: `origin/main` at the moment this gate was installed (the merge commit
 * of #1427). Ten non-merge commits reachable from it are absent from `origin/develop`'s ancestry —
 * nine Dependabot bumps (#1316–#1328) and one human feature branch PR'd straight to `main`
 * (`fbf9f5156`, #1216, the incident that motivated `main-pr-source-guard`). Their CONTENT is on
 * develop (squash-copied by #1415) and `main`'s tree is already identical to the develop commit
 * #1427 promoted, so nothing is lost by excluding them; only their ancestry is unrecoverable
 * without rewriting `main`, which `non_fast_forward` forbids.
 *
 * ANTI-ROT: this is a one-time amnesty, not a growing allowlist, and it is defended from BOTH sides.
 * Truncation — the gate FAILS hard if the baseline commit is unreachable, rather than evaluating A2
 * without an exclusion. Widening — `ADOPTION_BASELINE_DEBT` pins how many commits the amnesty is
 * allowed to cover, and `evaluatePromotion` reports a finding if the real count differs, so advancing
 * the baseline to a newer `main` commit to bury fresh squash debt goes red instead of silently
 * passing. (A test asserts a post-baseline commit is NOT amnestied.)
 */
export const ADOPTION_BASELINE = 'a1a6bb830acf60097304de1f4a96f9f50ecd2503';

/**
 * How many non-merge commits the frozen amnesty covers. **0 — the debt is discharged.**
 *
 * It was 10 at adoption: nine Dependabot bumps and one branch PR'd straight to `main`, whose
 * ancestry was unrecoverable without rewriting `main`. On 2026-07-27 `develop` absorbed `main`'s
 * ancestry, so all ten are now reachable from `develop` and the exclusion excludes nothing.
 * Re-measured: `git rev-list origin/main ^origin/develop --no-merges --count` = 0.
 *
 * The equality check is deliberately kept rather than relaxed. At 0 there is nothing left to
 * discharge, so ANY deviation is new debt — the amnesty is spent, and this is a floor, not a budget.
 *
 * Note what fired: the gate reported the debt being PAID as a violation, because it compares for
 * equality while its own documentation describes only the widening direction. A guard going red on a
 * correct, desirable state is the over-checking failure mode. Recorded because the fix was to make
 * the constant true, not to loosen the comparison.
 */
export const ADOPTION_BASELINE_DEBT = 0;

/** How the gate learns it is looking at a promotion. */
export const PROMOTION_BASE = 'main';

/** Run git in `cwd`, returning `{ code, stdout, stderr }`. */
export function runGit(args, cwd = WORKSPACE_ROOT) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return {
    code: result.status ?? 1,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  };
}

/** True when `rev` resolves to a commit in this repository. */
export function revExists(git, rev) {
  return git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]).code === 0;
}

/**
 * Evaluate A1/A2/A3 against a promotion head. Pure with respect to the repository: `git` is the
 * only I/O, so tests drive it against throwaway repositories.
 *
 * @returns {{ findings: {id: string, detail: string}[], currentDebt: number }}
 */
export function evaluatePromotion({
  git,
  head,
  mainRef = 'origin/main',
  developRef = 'origin/develop',
  baseline = ADOPTION_BASELINE,
}) {
  const findings = [];

  for (const [label, rev] of [
    ['promotion head', head],
    ['main ref', mainRef],
    ['develop ref', developRef],
  ]) {
    if (!revExists(git, rev)) {
      findings.push({
        id: 'REF',
        detail: `${label} \`${rev}\` does not resolve to a commit. This gate reads full ancestry — check out with \`fetch-depth: 0\` and fetch both integration branches.`,
      });
    }
  }
  if (findings.length > 0) return { findings, currentDebt: 0 };

  const baselineReachable = revExists(git, baseline);
  if (!baselineReachable) {
    findings.push({
      id: 'BASELINE',
      detail: `the frozen adoption baseline \`${baseline}\` is unreachable. It is the one-time amnesty for the ten pre-adoption commits on \`main\`; without it A2 cannot distinguish that legacy debt from a NEW squashed promotion, so the gate refuses to run rather than pass vacuously.`,
    });
    return { findings, currentDebt: 0 };
  }

  // ANTI-ROT, widening side: how much the amnesty actually covers must equal what was frozen at
  // adoption. Advancing ADOPTION_BASELINE to a newer `main` commit would bury fresh squash debt inside
  // the exclusion and every assertion would still read green; this makes that move red. Only enforced
  // for the real baseline — fixtures pass their own.
  if (baseline === ADOPTION_BASELINE) {
    const amnesty = git(['rev-list', baseline, `^${developRef}`, '--no-merges', '--count']);
    const covered = amnesty.code === 0 ? Number(amnesty.stdout || '0') : -1;
    if (covered !== ADOPTION_BASELINE_DEBT) {
      findings.push({
        id: 'BASELINE',
        detail: `the frozen amnesty covers ${covered} non-merge commit(s), but ${ADOPTION_BASELINE_DEBT} were frozen at adoption. The baseline is a ONE-TIME amnesty, not a growing allowlist — if it was advanced to a newer \`main\` commit it would silently absolve new squash debt. Restore \`ADOPTION_BASELINE\` (${ADOPTION_BASELINE.slice(0, 9)}) or, if the change is deliberate, update \`ADOPTION_BASELINE_DEBT\` in the same commit with the reason.`,
      });
    }
  }

  // A1 — the promotion carries main's ancestry.
  if (git(['merge-base', '--is-ancestor', mainRef, head]).code !== 0) {
    findings.push({
      id: 'A1',
      detail:
        `\`${mainRef}\` is NOT an ancestor of the promotion head. The promotion would be computed against a STALE merge base and re-conflict on every manifest a previous sync already reconciled ` +
        `(#1415 → #1413). Build the promotion branch so it records main's ancestry:\n` +
        `      node scripts/harness/promote.mjs\n` +
        `    (equivalently: \`git checkout -B release/promote-develop-to-main origin/develop && git merge --no-ff origin/main\`).`,
    });
  }

  // A2 — no non-merge content on the head outside develop's ancestry, past the frozen baseline.
  const unseen = git([
    'rev-list',
    head,
    `^${developRef}`,
    `^${baseline}`,
    '--no-merges',
    '--format=%h %s',
    '--no-commit-header',
  ]);
  // FAIL CLOSED. `runGit` maps any spawn/git failure to `{ code: 1, stdout: '' }`, and empty stdout is
  // exactly what "assertion satisfied" looks like — so an unchecked exit code turns a broken git into a
  // silent pass. `--no-commit-header` needs git >= 2.33, which is a real way to reach this branch.
  if (unseen.code !== 0) {
    findings.push({
      id: 'A2',
      detail: `\`git rev-list\` failed (exit ${unseen.code}), so A2 could not be evaluated: ${unseen.stderr || '(no stderr)'}. Refusing to report a pass for an assertion that never ran.`,
    });
  }
  const unseenLines = unseen.stdout.split('\n').filter((line) => line.length > 0);
  if (unseenLines.length > 0) {
    findings.push({
      id: 'A2',
      detail:
        `the promotion head carries ${unseenLines.length} non-merge commit(s) that \`${developRef}\` has never seen:\n` +
        unseenLines.map((line) => `      ${line}`).join('\n') +
        `\n    A promotion promotes what \`develop\` already integrated. A commit here means either a PREVIOUS promotion was squashed (its squash commit is a non-merge commit on \`main\`, off develop) or something landed on \`main\` directly. Back-merge \`main\` into \`develop\` with a MERGE COMMIT, then rebuild the promotion branch.`,
    });
  }

  // A3 — the promotion promotes develop's tree, unchanged.
  const forkPoint = git(['merge-base', developRef, head]);
  if (forkPoint.code !== 0) {
    findings.push({
      id: 'A3',
      detail: `no merge base between \`${developRef}\` and the promotion head — the branch was not cut from \`develop\`.`,
    });
  } else {
    const introduced = git(['diff', '--name-only', forkPoint.stdout, head]);
    // Fail closed for the same reason as A2 above: an empty stdout from a FAILED diff is
    // indistinguishable from an empty diff.
    if (introduced.code !== 0) {
      findings.push({
        id: 'A3',
        detail: `\`git diff\` failed (exit ${introduced.code}), so A3 could not be evaluated: ${introduced.stderr || '(no stderr)'}. Refusing to report a pass for an assertion that never ran.`,
      });
    }
    const files = introduced.stdout.split('\n').filter((line) => line.length > 0);
    if (files.length > 0) {
      findings.push({
        id: 'A3',
        detail:
          `the promotion changes ${files.length} file(s) relative to the \`${developRef}\` commit it was cut from (${forkPoint.stdout.slice(0, 9)}):\n` +
          files
            .slice(0, 20)
            .map((file) => `      ${file}`)
            .join('\n') +
          (files.length > 20 ? `\n      … and ${files.length - 20} more` : '') +
          `\n    A promotion must promote develop's tree UNCHANGED. Content here came from \`main\` (a hotfix, a direct push, or a conflict-resolving "evil" merge) and \`develop\` does not have it — promoting now would leave the two branches diverged again. Back-merge \`main\` into \`develop\` FIRST, then rebuild the promotion branch.`,
      });
    }
  }

  // Reported for visibility only — it gates nothing. This is the CURRENT debt (non-merge commits on
  // `main` that `develop`'s ancestry lacks), which at adoption equals the frozen amnesty and grows if
  // new debt lands. A2 is what actually blocks; this number is how a reader notices drift.
  const debt = git(['rev-list', mainRef, `^${developRef}`, '--no-merges', '--count']);
  return { findings, currentDebt: debt.code === 0 ? Number(debt.stdout || '0') : -1 };
}

/** Resolve the promotion head, refusing GitHub's synthetic merge ref. */
export function resolveHead({ argv = [], env = process.env } = {}) {
  const flagIndex = argv.indexOf('--head');
  if (flagIndex >= 0 && argv[flagIndex + 1] === undefined) {
    return { head: undefined, error: '`--head` was passed with no value.' };
  }
  const fromFlag = flagIndex >= 0 ? argv[flagIndex + 1] : undefined;
  const fromEnv = env.PR_HEAD_SHA || env.GITHUB_PR_HEAD_SHA;
  const explicit = fromFlag || fromEnv;
  if (explicit) return { head: explicit, error: undefined };
  if (env.GITHUB_EVENT_NAME === 'pull_request') {
    return {
      head: undefined,
      error:
        "refusing to evaluate `HEAD` on a `pull_request` event: it is GitHub's synthetic `refs/pull/N/merge`, whose FIRST parent is the base branch — A1/A3 would pass VACUOUSLY. Pass `--head ${{ github.event.pull_request.head.sha }}` (or set PR_HEAD_SHA).",
    };
  }
  return { head: 'HEAD', error: undefined };
}

/** Resolve the PR base ref (`--base`, else `GITHUB_BASE_REF`). */
export function resolveBase({ argv = [], env = process.env } = {}) {
  const flagIndex = argv.indexOf('--base');
  if (flagIndex >= 0) return argv[flagIndex + 1] ?? '';
  return env.GITHUB_BASE_REF || '';
}

export async function main({ argv = process.argv.slice(2), env = process.env, cwd } = {}) {
  const git = (args) => runGit(args, cwd ?? WORKSPACE_ROOT);
  const base = resolveBase({ argv, env });

  if (base !== PROMOTION_BASE) {
    process.stdout.write(
      `promotion-ancestry scan SKIPPED — not a promotion: PR base is \`${base || '(none)'}\`, this gate only governs PRs into \`${PROMOTION_BASE}\`.\n`,
    );
    return;
  }

  const { head, error } = resolveHead({ argv, env });
  if (error) {
    process.stdout.write(`promotion-ancestry scan failed (INFRA-051): ${error}\n`);
    process.exitCode = 1;
    return;
  }

  const { findings, currentDebt } = evaluatePromotion({ git, head });
  if (findings.length > 0) {
    process.stdout.write('promotion-ancestry scan failed (INFRA-051):\n');
    for (const finding of findings) {
      process.stdout.write(`  - [${finding.id}] ${finding.detail}\n`);
    }
    process.stdout.write(
      '\nA squash records no ancestry link, so the NEXT promotion re-computes against the old merge base\n' +
        'and re-conflicts on the manifests the last sync already reconciled. Merging this PR as a squash is\n' +
        'blocked by `protect-main` (`allowed_merge_methods: ["merge"]`); this gate blocks promoting FROM a\n' +
        'base that already lost the link.\n',
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `promotion-ancestry scan passed — A1/A2/A3 hold for ${head} (current non-merge debt on \`main\`: ${currentDebt} commit(s); ${ADOPTION_BASELINE_DEBT} amnestied at the frozen baseline ${ADOPTION_BASELINE.slice(0, 9)}).\n`,
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  await main();
}

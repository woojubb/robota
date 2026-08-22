#!/usr/bin/env node

/**
 * ci-mirror-map — the DECLARATION of what `pnpm harness:verify-like-ci` mirrors, at step
 * granularity, and of what it deliberately does not.
 *
 * WHY (INFRA-056). The entry point is named across the rules and skills as *the* CI-equivalent
 * verification gate, and it ran neither `pnpm build` nor any package's test suite — the two gates
 * most likely to catch a functional regression. "I ran the CI-equivalent check" was a much weaker
 * claim than it read as, and nobody could see the difference. It is the fail-open shape INFRA-048
 * and INFRA-050 closed elsewhere: a check reporting success over ground it never covered.
 *
 * The fix is not more prose. It is this table plus the anti-drift test over it
 * (`__tests__/ci-mirror-map.test.mjs`), which asserts, offline:
 *
 *   1. Every required status check on the mirrored branch is either mirrored by at least one stage
 *      or listed in `NOT_MIRRORED` with a reason. No context may be silently absent.
 *   2. Every `run:` STEP of every mirrored job is claimed by a stage or declared CI plumbing. This
 *      is deliberately step-level and not context-level: a context-level pin is satisfied by
 *      mapping `quality -> affected-verify` while `quality`'s OTHER two run-steps
 *      (`build-contracts`, the agent-cli bintests) go unmirrored — the pin would certify coverage
 *      that does not exist, which is this item's own defect wearing a test.
 *   3. Every declared context and every declared step exists in `ci.yml` as written. Nothing here
 *      is hand-copied prose: the workflow is parsed.
 *
 * So a required job added to `protect-develop`, or a step added to one of the jobs it requires,
 * turns `pnpm harness:test` RED until this file answers for it.
 *
 * The ruleset side is pinned by `.github/required-status-checks.json` (the INFRA-055 declaration,
 * extended here with a `develop` entry) and reconciled against the LIVE ruleset by
 * `scan-main-required-checks.mjs --live`, which `.github/workflows/ruleset-drift.yml` already runs
 * on a schedule.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { splitWorkflowJobs } from './scan-ci-base-history.mjs';
import { splitJobSteps } from './scan-main-required-checks.mjs';

export const CI_WORKFLOW = path.join('.github', 'workflows', 'ci.yml');
export const REQUIRED_CHECKS_DECLARATION = path.join('.github', 'required-status-checks.json');

/**
 * The protected branch this entry point claims equivalence with.
 *
 * `protect-develop` and `protect-main` require deliberately different lists. `verify-like-ci` exists
 * to be run before pushing a feature branch, whose PR targets `develop`, so `develop` is the list it
 * mirrors. A promotion to `main` is a different gate with its own entry point — `protect-main`'s
 * substantive required context is `release-grade verification`, which runs `pnpm harness:verify:release`.
 */
export const MIRRORED_BRANCH = 'develop';

/**
 * The stage table.
 *
 * `mirrors` lists the ci.yml jobs and the exact step names a stage reproduces — parsed and asserted,
 * so a drift in ci.yml is traceable to the stage that must follow it. It is a LIST because CI
 * duplicates work across jobs that a single local run does once: `build`, `tui-e2e` and
 * `examples-typecheck` each build the packages inside their own job, and one local `pnpm build`
 * answers for all three. Claiming those steps under the stage that actually performs them, rather
 * than under the stage that merely benefits, is what keeps the map readable as evidence.
 *
 * `extra` marks a stage that mirrors no CI job at all; it must say what it covers instead, because a
 * stage nobody can trace to a required check is either valuable for a stated reason or is drift.
 *
 * `needsBuildOutput` is the DECLARATION the order is derived from, and
 * `__tests__/ci-mirror-map.test.mjs` pins the two together: a stage that reads build output may not
 * be listed before `build`, and a stage that declares nothing is a test failure rather than a stage
 * that silently sorts as "needs nothing".
 *
 * ORDER IS DELIBERATE, in two tiers (HARNESS-058):
 *   1. Stages that read NO build output run first, so a prettier violation or a bad commit subject
 *      surfaces in seconds rather than behind the minutes-long `build` and `tui-e2e` stages.
 *   2. `build` runs before every stage that consumes build output. `typecheck` used to sit in tier 1
 *      on the assumption that a type check needs nothing — it needs the cross-package declaration
 *      files `build` emits, so on a fresh worktree it went red on a branch that changed no code, and
 *      a missing-declaration error is indistinguishable from a real type error. A prerequisite runs
 *      before what needs it; a stage that cannot have its prerequisite met says so instead
 *      (`tree-prerequisites.mjs`).
 * No stage is skipped because an earlier one failed.
 */
export const CI_STAGES = [
  {
    name: 'format-check',
    needsBuildOutput: false,
    extra: '.lintstagedrc.json (prettier via .husky/pre-commit)',
    // A `format-check` CI job now EXISTS (INFRA-083) and calls this same stage, but the ruleset does
    // not require it yet, so this stage cannot claim to mirror it — the floor beside this table
    // refuses a mirror claim on a job nothing gates, and it is right to. The order is: land the job,
    // watch it run green, make it required, then move this entry to `mirrors`. Claiming coverage a
    // check does not yet provide is the shape that costs the most here.
    why: 'formatting is the ONE local stage no REQUIRED CI check re-runs, so a bypassed hook shipped drift nothing caught (INFRA-083)',
  },
  {
    name: 'commitlint',
    needsBuildOutput: false,
    mirrors: [{ job: 'commitlint', steps: ['Lint PR commit messages'] }],
    why: 'a subject over the length limit fails a REQUIRED check after the push, for a defect visible before it',
  },
  {
    name: 'harness-self-test',
    needsBuildOutput: false,
    mirrors: [{ job: 'scans', steps: ['Harness repository-contract test suite'] }],
    why: 'always runs repository-contract assertions that can inspect changed product, docs, and policy content',
  },
  {
    name: 'harness-hermetic-test',
    needsBuildOutput: false,
    mirrors: [{ job: 'scans', steps: ['Harness hermetic test suite'] }],
    why: 'runs the complete stripped-root-proven tier whenever a harness execution owner changes',
  },
  {
    name: 'scan-suite-dist-free',
    needsBuildOutput: false,
    mirrors: [{ job: 'scans', steps: ['Harness scan suite (dist-independent)'] }],
    why: 'a hardcoded build-output path literal resolves on a built tree and is a GHOST path in CI',
  },
  {
    name: 'build',
    needsBuildOutput: false,
    mirrors: [
      {
        job: 'build',
        steps: [
          'Show verification plan',
          'Detect build requirement',
          'Build monorepo',
          'Skip monorepo build when no build output is required',
        ],
      },
      {
        job: 'tui-e2e',
        steps: [
          'Build packages (only when the artifact was not restored — provides the robota binary)',
        ],
      },
      {
        job: 'examples-typecheck',
        steps: ['Build packages (only when the artifact was not restored)'],
      },
    ],
    why: 'CI builds before every job that reads dist; locally a STALE dist passes the presence-only freshness scan',
  },
  {
    name: 'typecheck',
    needsBuildOutput: true,
    extra: 'workspace-wide `pnpm -w typecheck`',
    why: 'strictly WIDER than the affected-scope typecheck `quality` runs, and ~6s after PERF-004 — cheap over-coverage, not drift',
  },
  {
    name: 'scan-suite',
    needsBuildOutput: true,
    mirrors: [{ job: 'quality', steps: ['Build-output contracts scan (dist-dependent)'] }],
    why: 'the dist-dependent scans silently no-op on an unbuilt tree',
  },
  {
    name: 'affected-verify',
    needsBuildOutput: true,
    mirrors: [{ job: 'quality', steps: ['Verify affected quality checks'] }],
    why: 'THE package test suites, lint and scoped typecheck — the gates verify-like-ci omitted entirely (INFRA-056)',
  },
  {
    name: 'binary-e2e',
    needsBuildOutput: true,
    mirrors: [{ job: 'quality', steps: ['Binary e2e (agent-cli bintests, dist-dependent)'] }],
    why: 'black-box e2e over the BUILT robota binary; no unit suite covers the packaged entry point',
  },
  {
    name: 'examples-typecheck',
    needsBuildOutput: true,
    mirrors: [{ job: 'examples-typecheck', steps: ['Typecheck examples'] }],
    why: 'examples are outside the workspace typecheck; a breaking public-surface change is invisible without them',
  },
  {
    name: 'tui-e2e',
    needsBuildOutput: true,
    mirrors: [{ job: 'tui-e2e', steps: ['Run the TUI PTY E2E suite against the real binary'] }],
    why: 'the live-TUI behaviours only a real PTY against the built binary can exercise',
  },
];

/**
 * Required contexts this entry point CANNOT reproduce, each with the reason and the manual command
 * that covers it.
 *
 * These are printed in the summary of every run — loudly when the diff makes them relevant — rather
 * than omitted. An entry point that quietly drops a required check is the exact defect INFRA-056
 * exists to close; one that says out loud which two it cannot run is an honest gate.
 *
 * `relevance` is a KEY the runner evaluates, not prose. A `relevantWhen` sentence with no code
 * behind it would describe a condition nobody computes — a smaller version of the same defect.
 */
export const NOT_MIRRORED = [
  {
    context: 'regression-red-proof (enforcing: accidental-green only)',
    reason:
      "the checker RUNS locally and is useful there, but it cannot reproduce this context's VERDICT. The opt-out is read from `PR_BODY` joined with the commit subjects, and off a pull request `PR_BODY` is empty — so an `allow-green-at-base: <reason>` declared in the body ALONE is invisible locally and the run reports `accidental-green` for a case CI legitimately excuses. A mirror that can disagree with the gate on the gate's own escape hatch is worse than no mirror: it would report a blocking verdict the required check does not hold.",
    relevance: 'code',
    relevantWhen: 'the diff changes product code — ci.yml reports docs-only work as N/A',
    manualCommand:
      'REGRESSION_RED_PROOF_ENFORCE=1 node scripts/harness/check-regression-red-proof.mjs   (reads the opt-out from commit subjects only; a PR-body opt-out will NOT be seen, so a local `accidental-green` is a question to check against the pull request, not a verdict)',
  },
  {
    context: 'dependency audit',
    reason:
      'downloads the osv-scanner binary from GitHub and scans the lockfile against the OSV.dev database — it needs network access and an external toolchain, so a local run could not be made deterministic or offline.',
    relevance: 'manifest-or-lockfile',
    relevantWhen: 'the diff touches `pnpm-lock.yaml` or any `package.json`',
    manualCommand:
      'osv-scanner scan source --config osv-scanner.toml --lockfile pnpm-lock.yaml   (see ci.yml → dependency-audit for the pinned version)',
  },
  {
    context: 'windows-shell',
    reason:
      'runs on `windows-latest` and exists precisely to exercise the win32 process-spawn path that no Linux or macOS host can execute. Mocked-platform unit tests are what it was added to stop being sufficient.',
    relevance: 'code',
    relevantWhen: 'the diff changes product code — ci.yml reports infrastructure-only work as N/A',
    manualCommand:
      'no local equivalent off a Windows host — review the win32 branches by hand, or push and read the check.',
  },

  {
    context: 'workflow provenance',
    reason:
      "runs on `pull_request_target` and judges the pull request's CHANGED-FILE LIST against the workflows that provide a required context, reading both from the base. Off a real pull request there is no file list and no base to compare it to, so a local run would either invent one or report a pass over a control plane it never inspected — which is the vacuity INFRA-097 built this gate to close.",
    relevance: 'guarded-workflow',
    relevantWhen: 'the diff touches any file under `.github/workflows/`',
    manualCommand:
      'node scripts/harness/scan-workflow-provenance.mjs --base-ref <base-sha> --head-ref <head-sha>   (the arguments are part of the entry point: with neither, the scan reports the standing exposure and judges no change)',
  },
  {
    context: 'review-gate',
    reason:
      "reads GitHub's code-scanning API for this PR's merge ref and compares it against the base branch. Both sides only exist once CodeQL has analysed a real pull request, so there is nothing a local run could read — a mirror would either invent the input or report a pass over an analysis that was never performed, which is the exact defect INFRA-048 built this gate to close.",
    relevance: 'code',
    relevantWhen:
      'the diff changes code at all — on a docs-only PR the gate itself resolves to `PASS (not-applicable)` via the same classifier ci.yml gates its build matrix on',
    manualCommand:
      'no local equivalent — push and read the check, or query it directly: gh api "repos/<owner>/<repo>/code-scanning/alerts?pr=<n>&state=open" --paginate  (note --paginate: a single page silently truncates, which is how a 40-high backlog once read as clean)',
  },
];

/** The relevance keys the runner knows how to evaluate. */
export const RELEVANCE_KEYS = ['manifest-or-lockfile', 'code', 'guarded-workflow'];

/**
 * `run:` steps of a mirrored job that are CI infrastructure rather than a check: provisioning the
 * runner, moving the build artifact between jobs, or echoing a skip. Each needs a reason, so this
 * cannot quietly become the place unmirrored checks are parked.
 */
export const CI_SETUP_STEPS = {
  build: [
    {
      step: 'Product verification not applicable',
      reason: 'explicit CI applicability result; the local stage gate reports the same omission',
    },
    {
      step: 'Install dependencies',
      reason: 'runner provisioning; a local run is already installed',
    },
    {
      step: 'Archive package build output',
      reason:
        'tars dist for the `package-dist` artifact — cross-JOB plumbing with no local counterpart',
    },
  ],
  quality: [
    {
      step: 'Product verification not applicable',
      reason:
        'explicit CI applicability result; the local affected plan reports zero product scopes',
    },
    {
      step: 'Install dependencies',
      reason: 'runner provisioning; a local run is already installed',
    },
    {
      step: 'Restore package build output',
      reason:
        'untars the `package-dist` artifact — locally the `build` stage produces dist in place',
    },
  ],
  scans: [
    {
      step: 'Install dependencies',
      reason: 'runner provisioning; a local run is already installed',
    },
  ],
  commitlint: [
    {
      step: 'Install dependencies',
      reason: 'runner provisioning; a local run is already installed',
    },
  ],
  'examples-typecheck': [
    {
      step: 'Examples verification not applicable',
      reason: 'explicit CI applicability result; the local stage gate reports the same omission',
    },
    {
      step: 'Restore package build output',
      reason:
        'artifact transport between jobs in one CI run; a local run builds in place and has nothing to restore',
    },
    {
      step: 'Install dependencies',
      reason: 'runner provisioning; a local run is already installed',
    },
  ],
  'tui-e2e': [
    {
      step: 'TUI verification not applicable',
      reason: 'explicit CI applicability result; the local stage gate reports the same omission',
    },
    {
      step: 'Restore package build output',
      reason:
        'artifact transport between jobs in one CI run; a local run builds in place and has nothing to restore',
    },
    {
      step: 'Install dependencies',
      reason: 'runner provisioning; a local run is already installed',
    },
  ],
};

// ---------------------------------------------------------------------------
// readers (pure over injected text where possible)
// ---------------------------------------------------------------------------

/** The declared required contexts for a branch, from the checked-in ruleset declaration. */
export function parseRequiredContexts(declarationJson, branch = MIRRORED_BRANCH) {
  const entry = declarationJson?.branches?.[branch];
  const contexts = entry?.required_status_checks;
  if (!Array.isArray(contexts) || contexts.length === 0)
    throw new Error(
      `${REQUIRED_CHECKS_DECLARATION} declares no required status checks for \`${branch}\`. An empty list would satisfy every mirror assertion vacuously — which is the defect this map exists to prevent.`,
    );
  return contexts;
}

/** Read `.github/required-status-checks.json` and return the mirrored branch's required contexts. */
export function readRequiredContexts(root, branch = MIRRORED_BRANCH) {
  const declarationPath = path.join(root, REQUIRED_CHECKS_DECLARATION);
  if (!existsSync(declarationPath))
    throw new Error(
      `${REQUIRED_CHECKS_DECLARATION} not found — the mirror has no ruleset to pin to.`,
    );
  return parseRequiredContexts(JSON.parse(readFileSync(declarationPath, 'utf8')), branch);
}

/** The step NAME of one parsed step block, if it declares one. */
export function stepName(stepText) {
  const match = /^ {6}(?:- )?name:[ \t]*(.*)$|^ {8}name:[ \t]*(.*)$/m.exec(stepText);
  return match ? (match[1] ?? match[2] ?? '').trim() : undefined;
}

/** Whether a parsed step block executes a command (as opposed to a pure `uses:` action step). */
export function stepHasRun(stepText) {
  return /^ {8}run:/m.test(String(stepText ?? ''));
}

/**
 * Every command-executing step of one ci.yml job, by name.
 *
 * Pure `uses:` steps (checkout, setup-node, upload/download-artifact) are excluded by construction
 * rather than by an allowlist: an action step runs no repository command, so there is nothing for a
 * local stage to reproduce.
 */
export function jobRunSteps(ciYaml, jobId) {
  const job = splitWorkflowJobs(ciYaml).find((entry) => entry.name === jobId);
  if (!job)
    throw new Error(
      `ci.yml declares no job \`${jobId}\` — the mirror map names one that does not exist.`,
    );
  return splitJobSteps(job.text)
    .filter((step) => stepHasRun(step))
    .map((step) => stepName(step))
    .filter(Boolean);
}

/** Read `.github/workflows/ci.yml` from disk. */
export function readCiWorkflow(root) {
  const workflowPath = path.join(root, CI_WORKFLOW);
  if (!existsSync(workflowPath))
    throw new Error(
      `${CI_WORKFLOW} not found — the mirror cannot be pinned to a workflow it cannot read.`,
    );
  return readFileSync(workflowPath, 'utf8');
}

/** Every `{ job, steps }` entry a stage declares, as a list regardless of how it was written. */
export function mirrorEntries(stage) {
  return stage?.mirrors ?? [];
}

/** The stages that claim at least one step of a given job. */
export function stagesMirroring(jobId) {
  return CI_STAGES.filter((stage) => mirrorEntries(stage).some((entry) => entry.job === jobId));
}

/** Every step name claimed by some stage for a given job. */
export function claimedSteps(jobId) {
  return new Set(
    CI_STAGES.flatMap((stage) =>
      mirrorEntries(stage)
        .filter((entry) => entry.job === jobId)
        .flatMap((entry) => entry.steps),
    ),
  );
}

/** A one-line, human-readable statement of what a stage reproduces — used in the run output. */
export function describeCiSource(stage) {
  if (stage.extra) return `${stage.extra} — mirrors no CI job; kept because ${stage.why}`;
  return mirrorEntries(stage)
    .map((entry) => `ci.yml → ${entry.job} → ${entry.steps.join(' + ')}`)
    .join('; ');
}

/** Every step name declared CI plumbing for a given job. */
export function plumbingSteps(jobId) {
  return new Set((CI_SETUP_STEPS[jobId] ?? []).map((entry) => entry.step));
}

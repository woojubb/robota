#!/usr/bin/env node

/**
 * Required-status-check substance gate (INFRA-055).
 *
 * A required status check is only enforcement if it can FAIL. Measured on promotion #1427, all five
 * contexts `protect-main` required were no-ops on a PR whose base is `main`: `build`, `quality`,
 * `scans` and `dependency audit` (then named `security audit`) opened with a "Skip duplicate ... for
 * main PR" echo and gated every
 * later step on `base_ref != 'main'` (5s/5s/6s/3s), and `commitlint`'s whole job was skipped. Branch
 * protection reported green from jobs that deliberately did no work, while the job that actually
 * verifies a promotion — `release-grade verification` — was not required at all.
 *
 * Each individual skip was defensible; the defect was that the REQUIRED LIST was never moved to
 * match. That is drift between two artifacts nobody diffs against each other, so it needs a
 * mechanical floor rather than a review habit.
 *
 * `.github/required-status-checks.json` is the SOURCE of what `protect-main` must require. This scan
 * asserts, offline, that every context it names resolves to a workflow job that actually runs and can
 * actually fail on a `main` PR:
 *
 *   R1  The context resolves to exactly one job in the declared workflow.
 *   R2  The workflow triggers on `pull_request` OR `pull_request_target` for `main`, with no
 *       `paths`/`paths-ignore` filter. Both planes dispatch off the base branch and both can carry a
 *       required context, so accepting only the first would have made INFRA-097's trusted control
 *       plane unrequireable — the plane exists precisely BECAUSE `pull_request` loads its definition
 *       from the pull request under test. Which plane a workflow uses is a separate judgement from
 *       whether its context can fail, and this rule is about the second.
 *       A path filter means some PR shape never triggers the workflow at all, and a required context
 *       that never REPORTS blocks the PR forever with no way to satisfy it (the #1436 review-gate
 *       rollback).
 *   R3  The job's own `if:`, if it has one, is EXACTLY `github.base_ref == 'main'`, and no step in
 *       it is gated on `base_ref`. A whitelist, because a blacklist of one spelling is not a gate:
 *       `!= "main"` in double quotes is the #1427 vacuous shape one character away, and
 *       `== 'develop'` is the #1436 permanent-pending shape, and both must be red.
 *   R7  The `pull_request` trigger declares `types:` including `edited`. Retargeting a PR's base
 *       fires `edited`, which GitHub's DEFAULT activity set omits — so an ABSENT `types:` is the
 *       failing case. Measured on PR #1442: a feature branch retargeted develop->main re-dispatched
 *       nothing and reported `mergeStateStatus: CLEAN` with all three main-only gates `SKIPPED`.
 *   R4  At least one step is unconditional, so the job cannot become an all-conditional shell whose
 *       every step evaluates false.
 *   R5  Neither the job nor any of its steps carries `continue-on-error`. That is the one FAIL-OPEN
 *       rot: the command fails, the check run still reports success.
 *
 * The `needs:` graph is NOT checked here. It was, as R6 — "every job named in `needs:` is itself
 * substantive on a `main` PR" — and a harness audit measured that rule down to zero live subjects:
 * none of `main`'s three required jobs declares a `needs:` key at all, so R6 examined nothing on the
 * branch it was written for while `scan-required-check-needs` (INFRA-060) held the same property over all 6
 * live edges, on every declared branch, and for a dependency that RUNS AND FAILS as well as one
 * excluded by its own `if:`. Two rules over one graph, one of them looking at nothing, is a worse
 * state than one rule: it reads as double coverage. `scan-required-check-needs` is the sole owner.
 *
 * The declaration must be non-empty and every referenced file must be readable: an empty list would
 * satisfy every assertion vacuously, which is the failure this scan exists to prevent.
 *
 * Hermetic by default — it reads only checked-in files, so it always reaches a verdict and never
 * prints SKIP, and no GitHub API outage can redden the release gate that runs it. `--live`
 * additionally reconciles the declaration against the live ruleset via `gh`; the scheduled
 * `.github/workflows/ruleset-drift.yml` runs that half, where a failure costs a red cron and not a
 * blocked promotion.
 *
 * Exit code 0 = every required context can fail on a `main` PR, 1 = at least one cannot.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { fetchAllPages } from './github-api.mjs';
import {
  DECLARATION_FILE,
  readDeclaration,
  readDeclarationBranch,
  strictPolicyFindings,
} from './required-status-checks-declaration.mjs';
import { splitWorkflowJobs, stripComments } from './scan-ci-base-history.mjs';
import {
  GOVERNED_BRANCH,
  RECONCILED_BRANCHES,
  originSlug,
  reconcileLive,
  reconcileLiveBranch,
} from './required-status-checks-live.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

/** Owned by the declaration module; re-exported so this scan stays the readers' entry point. */
export { DECLARATION_FILE, readDeclaration };

/** The protected branch whose contexts this scan asserts can FAIL. `develop`'s required list
 *  deliberately contains jobs that skip on a docs-only PR (tui-e2e / examples-typecheck /
 *  windows-shell, gated on `changes`), so the R1-R7 assertions below do not apply there.
 *  `protect-develop` is nonetheless DECLARED in the same file (INFRA-056) — as the list
 *  `verify-like-ci` claims equivalence with — and `--live` reconciles both (`RECONCILED_BRANCHES`). */
export { GOVERNED_BRANCH, RECONCILED_BRANCHES, originSlug, reconcileLive, reconcileLiveBranch };

/** A condition that makes a job or step conditional on the PR's base branch — the vacuous shape. */
const BASE_REF_CONDITION = /github\.base_ref/;

/**
 * The ONLY job-level condition a required `main` context may carry, in either quote style. This is a
 * WHITELIST on purpose. The first draft blacklisted `base_ref != 'main'`, which is a blacklist of one
 * spelling: `!= "main"` (double quotes) slipped through the vacuous shape it was written to catch,
 * and `== 'develop'` slipped through the permanent-pending shape (#1436) entirely. Anything that is
 * not exactly this expression is a finding, so a spelling nobody anticipated fails closed.
 */
const ALLOWED_JOB_CONDITION = /^github\.base_ref\s*==\s*['"]main['"]$/;

/**
 * A `pull_request` trigger must handle `edited`. Retargeting a PR's base fires `edited`, which is NOT
 * in GitHub's default activity set — measured on throwaway PR #1442: a feature branch retargeted
 * develop→main re-dispatched nothing, kept the `skipping` conclusions it earned as a develop PR, and
 * reported `mergeStateStatus: CLEAN`. An ABSENT `types:` is therefore the FAILING case, not a safe
 * default: it means the default set, which omits `edited`.
 */
const REQUIRED_TRIGGER_TYPE = 'edited';

/** Job-level keys sit at four spaces inside a job block; `splitWorkflowJobs` strips the job header. */
function jobLevelValue(jobText, key) {
  const match = new RegExp(`^ {4}${key}:[ \\t]*(.*)$`, 'm').exec(stripComments(jobText));
  return match ? match[1].trim() : undefined;
}

/** The `needs:` of a job, in either the inline-list or the block-list spelling. */
export function jobNeeds(jobText) {
  const text = stripComments(jobText);
  const inline = jobLevelValue(jobText, 'needs');
  if (inline === undefined) return [];
  if (inline.startsWith('[')) {
    return inline
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }
  if (inline !== '') return [inline.replace(/^['"]|['"]$/g, '')];
  // Block list: `needs:` on its own line, entries indented beneath it.
  const block = /^ {4}needs:\s*$\n((?: {6}- .*\n?)+)/m.exec(text);
  if (!block) return [];
  return block[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/^ {6}- /, '').trim())
    .filter(Boolean);
}

/** Split a job's `steps:` block into one text block per step. */
export function splitJobSteps(jobText) {
  const lines = stripComments(jobText).split(/\r?\n/);
  const stepsIndex = lines.findIndex((line) => /^ {4}steps:\s*$/.test(line));
  if (stepsIndex === -1) return [];
  const steps = [];
  let current = null;
  for (const line of lines.slice(stepsIndex + 1)) {
    if (line.trim() !== '' && !/^ {6}/.test(line)) break; // dedent ends the steps block
    if (/^ {6}- /.test(line)) {
      current = [line];
      steps.push(current);
      continue;
    }
    if (current) current.push(line);
  }
  return steps.map((step) => step.join('\n'));
}

/** The `if:` of a single step block, if it declares one. */
export function stepCondition(stepText) {
  const match = /^ {6}(?:- )?if:[ \t]*(.*)$|^ {8}if:[ \t]*(.*)$/m.exec(stepText);
  if (!match) return undefined;
  return (match[1] ?? match[2] ?? '').trim();
}

/**
 * The `pull_request:` trigger of a workflow: which base branches it covers and whether it carries a
 * path filter. Parsed from the `on:` block only — a `paths-ignore` further down inside a job is not
 * a trigger filter.
 */
export function pullRequestTrigger(workflowText) {
  const text = stripComments(workflowText);
  const onBlock = /^on:\s*$\n((?:[ \t]+.*\n?)*)/m.exec(text);
  if (!onBlock) return undefined;
  // Either plane. `pull_request_target` is matched FIRST because `pull_request:` would not match it
  // anyway (the colon differs), but ordering it explicitly keeps the intent readable: a control-plane
  // gate uses the target plane on purpose, and a rule that only knew the other one would refuse the
  // very shape INFRA-097 exists to install.
  let kind;
  let prBlock;
  for (const candidate of ['pull_request_target', 'pull_request']) {
    prBlock = new RegExp(`^ {2}${candidate}:\\s*$\\n((?:(?: {4}.*)?\\n?)*)`, 'm').exec(onBlock[1]);
    if (prBlock) {
      kind = candidate;
      break;
    }
  }
  if (!prBlock) return undefined;
  const body = prBlock[1];
  const typesInline = / {4}types:[ \t]*\[(.*)\]/.exec(body);
  const typesBlock = /^ {4}types:[ \t]*$\n((?: {6}- .*\n?)*)/m.exec(body);
  const types = typesInline
    ? typesInline[1]
        .split(',')
        .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
    : typesBlock
      ? [...typesBlock[1].matchAll(/^ {6}- +['"]?([^'"\n]+)['"]?$/gm)].map((match) =>
          match[1].trim(),
        )
      : undefined; // undefined = key absent = GitHub's default set, which omits `edited`.
  const branchesInline = / {4}branches:[ \t]*\[(.*)\]/.exec(body);
  // The block list must be scoped to the `branches:` key. Matching every `      - x` in the trigger
  // body reads a sibling `paths-ignore:` list as branch names — which would make a path-filtered
  // workflow look like it covers `main` and silently mask an R2 finding.
  const branchesBlock = /^ {4}branches:[ \t]*$\n((?: {6}- .*\n?)*)/m.exec(body);
  const branches = branchesInline
    ? branchesInline[1]
        .split(',')
        .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
    : [...(branchesBlock?.[1] ?? '').matchAll(/^ {6}- +['"]?([^'"\n]+)['"]?$/gm)]
        .map((match) => match[1].trim())
        .filter(Boolean);
  return { kind, branches, types, hasPathFilter: /^ {4}paths(-ignore)?:/m.test(body) };
}

/** Locate a declared context's job block, and classify whether it is substantive on a `main` PR. */
function inspectJob({ root, workflow, jobId }) {
  const file = path.join(root, workflow);
  if (!existsSync(file)) return { error: `workflow \`${workflow}\` does not exist.` };
  const text = readFileSync(file, 'utf8');
  const job = splitWorkflowJobs(text).find((entry) => entry.name === jobId);
  if (!job) return { error: `workflow \`${workflow}\` declares no job \`${jobId}\`.` };
  return { workflowText: text, job };
}

/**
 * The reason a job's own `if:` disqualifies it as a required `main` context, or `undefined` when it
 * is fine. Whitelist, not blacklist: no condition at all is fine, `github.base_ref == 'main'` is
 * fine, and EVERYTHING ELSE is a finding — including spellings this scan has never seen.
 */
export function jobConditionProblem(jobText) {
  const condition = jobLevelValue(jobText, 'if');
  if (condition === undefined || condition === '') return undefined;
  if (ALLOWED_JOB_CONDITION.test(condition)) return undefined;
  return condition;
}

/** Every finding for the declared `main` required list. */
export function findRequiredCheckFindings(root = WORKSPACE_ROOT) {
  const findings = [];
  let contexts;
  try {
    contexts = readDeclaration(root, GOVERNED_BRANCH);
  } catch (error) {
    return [{ context: `(${DECLARATION_FILE})`, detail: error.message }];
  }

  for (const entry of contexts) {
    const { context, workflow, job: jobId } = entry;
    const report = (detail) => findings.push({ context, detail });
    if (!context || !workflow || !jobId) {
      report('declaration entry is missing `context`, `workflow` or `job`.');
      continue;
    }

    const inspected = inspectJob({ root, workflow, jobId });
    if (inspected.error) {
      report(`[R1] ${inspected.error}`);
      continue;
    }
    const { workflowText, job } = inspected;

    // R1 — the job's display name must be the required context, or branch protection matches nothing.
    const declaredName = (jobLevelValue(job.text, 'name') ?? jobId).replace(/^['"]|['"]$/g, '');
    if (declaredName !== context) {
      report(
        `[R1] \`${workflow}\` job \`${jobId}\` publishes the context \`${declaredName}\`, not \`${context}\`. Branch protection matches on the context NAME, so a required context nothing publishes never reports and blocks the PR forever.`,
      );
    }

    // R2 — the workflow must trigger for every PR to `main`, with no path filter.
    const trigger = pullRequestTrigger(workflowText);
    if (!trigger) {
      report(
        `[R2] \`${workflow}\` declares no \`pull_request:\` or \`pull_request_target:\` trigger this scan can read.`,
      );
    } else {
      if (trigger.branches.length > 0 && !trigger.branches.includes(GOVERNED_BRANCH)) {
        report(
          `[R2] \`${workflow}\`'s \`${trigger.kind}\` trigger does not cover \`${GOVERNED_BRANCH}\` (branches: ${trigger.branches.join(', ') || '(none)'}).`,
        );
      }
      if (trigger.hasPathFilter) {
        report(
          `[R2] \`${workflow}\`'s \`${trigger.kind}\` trigger carries a \`paths\`/\`paths-ignore\` filter. Some PR shape then never triggers it, the context never reports, and the PR is blocked forever with no way to satisfy it.`,
        );
      }
      if (trigger.types === undefined) {
        report(
          `[R7] \`${workflow}\`'s \`${trigger.kind}\` trigger declares no \`types:\`, so it uses GitHub's DEFAULT activity set, which omits \`${REQUIRED_TRIGGER_TYPE}\`. Retargeting a PR's base fires \`${REQUIRED_TRIGGER_TYPE}\` — measured on throwaway PR #1442, a feature branch retargeted develop→main re-dispatched nothing, kept the \`skipping\` conclusions it earned as a develop PR, and reported \`mergeStateStatus: CLEAN\`. An absent \`types:\` is the failing case, not a safe default.`,
        );
      } else if (!trigger.types.includes(REQUIRED_TRIGGER_TYPE)) {
        report(
          `[R7] \`${workflow}\`'s \`${trigger.kind}\` \`types:\` (${trigger.types.join(', ')}) omits \`${REQUIRED_TRIGGER_TYPE}\`, so a base retarget re-dispatches nothing and this required context keeps whatever conclusion it earned against the OLD base — \`skipping\`, which branch protection accepts (PR #1442).`,
        );
      }
    }

    // R3 — the job must be unconditional or gated on exactly `base_ref == 'main'`, nothing else.
    const conditionProblem = jobConditionProblem(job.text);
    if (conditionProblem !== undefined) {
      report(
        `[R3] \`${jobId}\`'s job-level \`if: ${conditionProblem}\` is not \`github.base_ref == 'main'\`, so there is a PR to \`${GOVERNED_BRANCH}\` for which this job does not run. A skipped job publishes a \`skipped\` conclusion, which branch protection ACCEPTS (INFRA-050); a job that never runs at all leaves the context permanently pending (#1436). Only an absent condition, or exactly \`github.base_ref == 'main'\`, is admissible.`,
      );
    }
    const steps = splitJobSteps(job.text);
    const baseRefSteps = steps.filter((step) => BASE_REF_CONDITION.test(stepCondition(step) ?? ''));
    if (baseRefSteps.length > 0) {
      report(
        `[R3] ${baseRefSteps.length} step(s) in \`${jobId}\` are gated on \`github.base_ref\`. That is the #1427 echo shape verbatim: the job resolves green in seconds having executed nothing.`,
      );
    }

    // R4 — at least one step actually runs.
    if (steps.length === 0) {
      report(`[R4] \`${jobId}\` declares no steps this scan can read.`);
    } else if (steps.every((step) => stepCondition(step) !== undefined)) {
      report(
        `[R4] every step in \`${jobId}\` is conditional, so there is no shape of PR for which the job is guaranteed to do work.`,
      );
    }

    // R5 — the one fail-OPEN rot.
    if (/continue-on-error:\s*true/.test(stripComments(job.text))) {
      report(
        `[R5] \`${jobId}\` (or a step in it) sets \`continue-on-error: true\`. The command fails and the check run still reports SUCCESS — a required check that cannot go red.`,
      );
    }

    // The `needs:` graph is `scan-required-check-needs`'s subject, on every declared branch —
    // see this file's header for why the rule left here.
  }
  return findings;
}

/** Every branch `.github/required-status-checks.json` declares, in file order. */
export function declaredBranches(root = WORKSPACE_ROOT) {
  const file = path.join(root, DECLARATION_FILE);
  if (!existsSync(file)) return [];
  return Object.keys(JSON.parse(readFileSync(file, 'utf8'))?.branches ?? {});
}

/**
 * Every status-check context this repository's workflows can publish.
 *
 * GitHub names a check run after the job's `name:` when it has one, and after the job ID when it
 * does not. Branch protection matches on that string exactly.
 */
export function publishedContexts(root = WORKSPACE_ROOT) {
  const dir = path.join(root, '.github', 'workflows');
  // FAIL CLOSED for the same reason: an empty set makes EVERY declared context look unpublished,
  // which is loud rather than silent — but it is still a verdict over a tree that was never read.
  if (!existsSync(dir)) {
    throw new Error(
      '.github/workflows is missing, so no published context could be read. That is a broken checkout, not a repository whose workflows publish nothing.',
    );
  }
  const names = new Set();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;
    const text = readFileSync(path.join(dir, file), 'utf8');
    for (const job of splitWorkflowJobs(text)) {
      const declared = jobLevelValue(job.text, 'name');
      names.add(declared ? declared.replace(/^['"]|['"]$/g, '') : job.name);
    }
  }
  return names;
}

/**
 * R1, applied to EVERY declared branch rather than only `main` (issue #2036).
 *
 * R1's reasoning is not `main`-specific — "branch protection matches on the context NAME, so a
 * required context nothing publishes never reports and blocks the PR forever" is a fact about how
 * branch protection matches, and it is identical on `develop`. The `main`-only scope was a
 * contingent fact about which branch was being hardened when R1 was written, hardened into the rule.
 *
 * MEASURED when this was added: `develop`'s `deliberately_not_required` named `patch-coverage` and
 * `regression-red-proof`, while the jobs publish `patch-coverage (advisory)` and
 * `regression-red-proof (enforcing: accidental-green only)`. Neither was required, so neither was
 * harmful — and both were staged for promotion, where moving the existing entry would have required
 * a name nothing publishes and blocked every `develop` pull request permanently.
 *
 * So `deliberately_not_required` is IN SCOPE. An entry there is a promotion waiting to happen, and
 * checking only the live list would leave the trap exactly where it was found.
 */
export function findContextNameFindings(root = WORKSPACE_ROOT) {
  const file = path.join(root, DECLARATION_FILE);
  // FAIL CLOSED (HARNESS-052). Measured before this guard existed: over a root with no `.github`
  // this returned `[]`, which reads as "every declared name is published" when nothing was read at
  // all. The declaration file is the SOURCE of what each ruleset must require, so its absence is a
  // broken checkout, not a repository that has declared nothing.
  if (!existsSync(file)) {
    throw new Error(
      `${DECLARATION_FILE} is missing. Reporting "no findings" here would mean "nothing was examined", which is not the claim this check makes.`,
    );
  }
  const declaration = JSON.parse(readFileSync(file, 'utf8'));
  const published = publishedContexts(root);
  const findings = [];
  for (const [branchName, branch] of Object.entries(declaration?.branches ?? {})) {
    for (const [list, entries] of [
      ['required_status_checks', branch?.required_status_checks],
      ['deliberately_not_required', branch?.deliberately_not_required],
    ]) {
      for (const entry of entries ?? []) {
        const context = entry?.context;
        // A grouped entry names several contexts in one string for prose reasons; it is a label,
        // not a match target, and is skipped rather than reported as unpublished.
        if (typeof context !== 'string' || context.includes('/')) continue;
        if (published.has(context)) continue;
        findings.push({
          context,
          detail: `${DECLARATION_FILE} names it under \`branches.${branchName}.${list}\`, but no workflow job publishes that context. Branch protection matches on the NAME, so requiring it would leave every pull request permanently pending.`,
        });
      }
    }
  }
  return findings;
}

export async function main({ argv = process.argv.slice(2) } = {}) {
  const findings = findRequiredCheckFindings();
  const names = findContextNameFindings();
  const live = argv.includes('--live') ? reconcileLive() : [];
  const all = [...findings, ...names, ...live];

  if (all.length > 0) {
    process.stdout.write('main-required-checks scan failed (INFRA-055):\n');
    for (const finding of all) {
      process.stdout.write(`  - ${finding.context}: ${finding.detail}\n`);
    }
    process.stdout.write(
      `\nA required status check is enforcement only if it can FAIL. On promotion #1427 all five required\n` +
        `contexts were no-ops and the PR merged on 3-6 second echoes. Fix the job, or drop the context from\n` +
        `${DECLARATION_FILE} AND from the live ruleset in the same change.\n`,
    );
    process.exitCode = 1;
    return;
  }

  const declared = readDeclaration(WORKSPACE_ROOT, GOVERNED_BRANCH);
  process.stdout.write(`::examined:: ${declared.length} required contexts\n`);
  process.stdout.write(
    `main-required-checks scan passed — ${declared.length} required context(s) on \`${GOVERNED_BRANCH}\` all run and can fail: ${declared.map((entry) => entry.context).join(', ')}.` +
      (argv.includes('--live') ? ' Live ruleset reconciled.' : '') +
      '\n',
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  await main();
}

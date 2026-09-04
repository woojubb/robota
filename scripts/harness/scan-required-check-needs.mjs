#!/usr/bin/env node

/**
 * Required-check dependency-edge guard (INFRA-060).
 *
 * A required status check reports `skipped` — not `failure` — when a job it `needs:` fails.
 * Branch protection ACCEPTS a skipped required check (INFRA-050). So a required job whose
 * dependency is NOT itself required has a silent bypass built into the job graph: the
 * dependency goes red for any reason at all, the required check publishes `skipping`, nothing
 * red remains on the PR, and it merges having never run the check.
 *
 * That is not a hypothesis. It is what #1424 did: `changes` errored on a grafted history and
 * three required contexts (`tui-e2e`, `examples-typecheck`, `windows-shell`) reported `skipping`
 * while the PR merged. INFRA-050 fixed the CAUSE of that particular red — the depth-limited
 * fetch. It did not touch the MECHANISM, which is reachable from any other way `changes` can
 * fail: a checkout failure, a runner OOM, a syntax error in the classifier, a Node crash.
 *
 * This scan is the SOLE owner of the `needs:` graph. `scan-main-required-checks.mjs` used to assert
 * an adjacent property as its R6 — on `main` only, and only for a dependency excluded by its own
 * `if:` — and a harness audit measured that rule down to zero live subjects, because none of `main`'s
 * three required jobs declares a `needs:` key at all. This scan covers every declared branch, the other half
 * of the shape (a dependency that RUNS AND FAILS), and the one case R6 held alone: a `needs:` naming
 * a job its workflow does not declare, which landed here before R6 was removed.
 *
 * The rule, applied per branch in `.github/required-status-checks.json`:
 *
 *   For each required context's job J, and each job D in J's `needs:` —
 *     D is itself a required context on that branch  → OK. D's failure is red on the PR, so
 *                                                      J reporting `skipping` hides nothing.
 *     otherwise                                      → J's own `if:` must be FAIL-SAFE: it must
 *                                                      contain a job-status function
 *                                                      (`always()`/`cancelled()`/`success()`/
 *                                                      `failure()`), which is what disables
 *                                                      GitHub's implicit `success()` over
 *                                                      `needs`, AND `needs.<D>.result`, which is
 *                                                      what makes the non-success case a
 *                                                      deliberate decision rather than an
 *                                                      accident.
 *
 * Both halves are required because either alone is insufficient: a status function without
 * `needs.<D>.result` runs the job unconditionally (losing the docs-only skip the gate exists
 * to provide), and `needs.<D>.result` without a status function never evaluates at all, because
 * GitHub skips the job before the expression is read.
 *
 * ANTI-ROT: this scan fails loudly when it examines ZERO dependency edges. Every assertion here
 * is quantified over edges the parser found, so a parser that stops finding them would report a
 * clean pass over nothing — the exact way `scan-main-required-checks` first shipped green on
 * three variants of its own defect.
 *
 * Exit code 0 = no required check can be silently skipped by a dependency, 1 = at least one can.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { splitWorkflowJobs, stripComments } from './scan-ci-base-history.mjs';
import { DECLARATION_FILE, jobNeeds } from './scan-main-required-checks.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

/**
 * A GitHub job-status check function. Its PRESENCE in an `if:` is what removes the implicit
 * `success()` GitHub otherwise wraps every `needs:` in — without one, the job never evaluates its
 * condition at all when a dependency fails, it is simply skipped.
 */
export const JOB_STATUS_FUNCTION = /\b(always|cancelled|success|failure)\s*\(\s*\)/;

/** A job-level scalar key. Job blocks are dedented by `splitWorkflowJobs`, so keys sit at 4 spaces. */
function jobLevelValue(jobText, key) {
  const match = new RegExp(`^ {4}${key}:[ \\t]*(.*)$`, 'm').exec(stripComments(jobText));
  return match ? match[1].trim() : undefined;
}

/** Every branch declared in the required-status-checks manifest, with its context list. */
export function readBranches(root = WORKSPACE_ROOT) {
  const file = path.join(root, DECLARATION_FILE);
  if (!existsSync(file)) throw new Error(`${DECLARATION_FILE} is missing.`);
  const declaration = JSON.parse(readFileSync(file, 'utf8'));
  const branches = Object.entries(declaration?.branches ?? {});
  if (branches.length === 0)
    throw new Error(
      `${DECLARATION_FILE} declares no branches. An empty declaration satisfies this scan vacuously.`,
    );
  return branches.map(([name, entry]) => ({
    name,
    contexts: entry?.required_status_checks ?? [],
  }));
}

/** The display name a job publishes as its status context. */
export function jobContextName(jobId, jobText) {
  return (jobLevelValue(jobText, 'name') ?? jobId).replace(/^['"]|['"]$/g, '');
}

/**
 * Whether a dependent job's `if:` is fail-safe with respect to one dependency: it both disables
 * the implicit `needs` success gate and names that dependency's result.
 */
export function isFailSafeFor(condition, dependency) {
  const text = String(condition ?? '');
  if (!JOB_STATUS_FUNCTION.test(text)) return false;
  return new RegExp(`needs\\.${dependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.result`).test(
    text,
  );
}

/** Findings across every declared branch, plus the number of dependency edges examined. */
export function findRequiredCheckNeedsFindings(root = WORKSPACE_ROOT) {
  const findings = [];
  let edges = 0;

  for (const branch of readBranches(root)) {
    const requiredContexts = new Set(branch.contexts.map((entry) => entry.context));

    for (const entry of branch.contexts) {
      const { context, workflow, job: jobId } = entry;
      if (!context || !workflow || !jobId) continue; // shape is scan-main-required-checks' assertion

      const file = path.join(root, workflow);
      if (!existsSync(file)) {
        findings.push({
          branch: branch.name,
          context,
          detail: `workflow \`${workflow}\` does not exist, so this scan cannot see what it depends on.`,
        });
        continue;
      }
      const jobs = splitWorkflowJobs(readFileSync(file, 'utf8'));
      const job = jobs.find((candidate) => candidate.name === jobId);
      if (!job) {
        findings.push({
          branch: branch.name,
          context,
          detail: `workflow \`${workflow}\` declares no job \`${jobId}\`.`,
        });
        continue;
      }

      const condition = jobLevelValue(job.text, 'if') ?? '';
      for (const need of jobNeeds(job.text)) {
        edges += 1;
        const dependency = jobs.find((candidate) => candidate.name === need);
        if (!dependency) {
          // `needs:` resolves within the job's OWN workflow. Falling back to the raw job id here
          // and comparing THAT against the required-context names made a dangling edge look
          // satisfied whenever another workflow happened to publish a required context of the
          // same name — the edge took the `continue` below and was reported clean. GitHub refuses
          // a workflow whose `needs:` does not resolve, so the required check never reports at
          // all: the permanent-pending shape #1436 rolled back for.
          findings.push({
            branch: branch.name,
            context,
            detail:
              `needs \`${need}\`, which no job in \`${workflow}\` declares. A \`needs:\` names a job in ` +
              `the same workflow, so GitHub cannot build this graph and \`${context}\` never reports — ` +
              `it stays pending forever rather than going red. Either declare \`${need}\` in ` +
              `\`${workflow}\` or remove the edge.`,
          });
          continue;
        }
        const dependencyContext = jobContextName(need, dependency.text);
        if (requiredContexts.has(dependencyContext)) continue;
        if (isFailSafeFor(condition, need)) continue;

        findings.push({
          branch: branch.name,
          context,
          detail:
            `needs \`${need}\`, which publishes the context \`${dependencyContext}\` — NOT a required ` +
            `check on \`${branch.name}\`. When \`${need}\` fails, GitHub reports \`${context}\` as ` +
            `\`skipped\` rather than \`failure\`, branch protection ACCEPTS a skipped required check ` +
            `(INFRA-050), and nothing red remains on the PR — it merges having never run this gate ` +
            `(#1424, three required contexts at once). Make \`${jobId}\`'s \`if:\` fail-safe: include a ` +
            `job-status function (e.g. \`!cancelled()\`) so the condition is evaluated at all when a ` +
            `dependency fails, AND \`needs.${need}.result\` so the non-success case is a decision. ` +
            `Requiring \`${dependencyContext}\` on \`${branch.name}\` is the other admissible fix — ` +
            `that is a ruleset change, and it must land in ${DECLARATION_FILE} in the same change.`,
        });
      }
    }
  }
  return { findings, edges };
}

export async function main() {
  let result;
  try {
    result = findRequiredCheckNeedsFindings();
  } catch (error) {
    process.stdout.write(`required-check-needs scan failed: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  const { findings, edges } = result;

  if (edges === 0) {
    process.stdout.write(
      'required-check-needs scan failed — it examined ZERO dependency edges.\n' +
        'Every assertion in this scan is quantified over `needs:` edges, so finding none means the\n' +
        'parser stopped reading the workflows, not that the graph is clean. A scan that passes over\n' +
        'nothing is the defect it exists to catch, one level up.\n',
    );
    process.exitCode = 1;
    return;
  }

  if (findings.length > 0) {
    process.stdout.write('required-check-needs scan failed (INFRA-060):\n');
    for (const finding of findings) {
      process.stdout.write(`  - [${finding.branch}] ${finding.context}: ${finding.detail}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`::examined:: ${edges} dependency edges\n`);
  process.stdout.write(
    `required-check-needs scan passed — ${edges} dependency edge(s) examined; no required check can be silently skipped by a dependency.\n`,
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  await main();
}

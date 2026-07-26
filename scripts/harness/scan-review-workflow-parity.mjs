#!/usr/bin/env node

/**
 * Review-workflow parity guard (INFRA-048-A).
 *
 * `anthropics/claude-code-action` validates, at run time, that the workflow file invoking it is
 * BYTE-IDENTICAL to the copy on the repository's default branch. When it is not, the action prints
 *
 *     Skipping action due to workflow validation: … must have identical content to the version on
 *     the repository's default branch
 *     Exiting due to workflow validation skip
 *
 * and **exits 0**. The job then reports `success` having reviewed nothing.
 *
 * Measured on this repo (2026-07-26): `.github/workflows/claude-code-review.yml` on `develop`
 * differed from `main` by exactly one line — `actions/checkout@v7` vs `@v4`, a major-version bump
 * merged to `develop` on 2026-07-24 (#1313) and never promoted. Every one of the last 100
 * `Claude Code Review` runs reported `success`; every one of the three inspected in detail had
 * reviewed nothing. That is the INFRA-048 defect in its purest form — a check reporting success
 * for work it did not do — and it is invisible from the outside, which is why it needs a
 * mechanical floor rather than a habit.
 *
 * Rule: every workflow that invokes the action must match the default branch's copy exactly.
 *
 * Changing such a workflow therefore requires promoting the change to the default branch before
 * (or in the same promotion as) the feature branch — the scan does not apply to a PR whose base IS
 * the default branch, because that PR is precisely the promotion that restores parity.
 *
 * FAIL-CLOSED: if the default branch's copy cannot be read, this scan exits 1. It cannot report a
 * pass it did not compute.
 *
 * Exit code 0 = every governed workflow is at parity, 1 = drift (or parity is unverifiable).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const WORKFLOW_DIR = path.join('.github', 'workflows');

/** The action whose workflow-validation makes parity load-bearing. */
export const VALIDATED_ACTION_PATTERN = /anthropics\/claude-code-action/;

/** Default-branch candidates, in order. */
const DEFAULT_BRANCH_CANDIDATES = ['origin/main', 'main'];

function tryGit(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return undefined;
  }
}

/** Workflow files (repo-relative) that invoke the validated action. Discovered, never hardcoded. */
export function listGovernedWorkflows(root = WORKSPACE_ROOT) {
  const dir = path.join(root, WORKFLOW_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => /\.ya?ml$/.test(entry))
    .sort()
    .map((entry) => path.join(WORKFLOW_DIR, entry))
    .filter((relPath) =>
      VALIDATED_ACTION_PATTERN.test(readFileSync(path.join(root, relPath), 'utf8')),
    );
}

/**
 * The parity rule does not apply while the change is being promoted INTO the default branch — that
 * PR is what restores parity. Determined from the event, not from a suppression comment.
 */
export function isPromotionToDefault(env = process.env, defaultBranch = 'main') {
  return env.GITHUB_BASE_REF?.trim() === defaultBranch;
}

/**
 * Compare each governed workflow against the default branch's copy.
 *
 * @returns {{findings: Array<{workflow: string, detail: string}>, checked: string[], defaultRef: string|undefined}}
 */
export function findReviewWorkflowParityFindings(root = WORKSPACE_ROOT) {
  const workflows = listGovernedWorkflows(root);
  if (workflows.length === 0) {
    return { findings: [], checked: [], defaultRef: undefined };
  }

  const defaultRef = DEFAULT_BRANCH_CANDIDATES.find(
    (ref) => tryGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], root) !== undefined,
  );
  if (defaultRef === undefined) {
    return {
      findings: [
        {
          workflow: '(default branch)',
          detail:
            `neither ${DEFAULT_BRANCH_CANDIDATES.join(' nor ')} resolves, so parity cannot be ` +
            'verified. This scan will not report a pass it did not compute — fetch the default ' +
            'branch (`fetch-depth: 0`).',
        },
      ],
      checked: workflows,
      defaultRef: undefined,
    };
  }

  const findings = [];
  for (const workflow of workflows) {
    const local = readFileSync(path.join(root, workflow), 'utf8');
    const onDefault = tryGit(['show', `${defaultRef}:${workflow}`], root);
    if (onDefault === undefined) {
      findings.push({
        workflow,
        detail:
          `does not exist on ${defaultRef}. The action refuses to run until the workflow file is ` +
          'present on the default branch — until then the job reports `success` having reviewed nothing.',
      });
      continue;
    }
    if (local !== onDefault) {
      findings.push({
        workflow,
        detail:
          `differs from ${defaultRef}. \`anthropics/claude-code-action\` requires BYTE-IDENTICAL ` +
          'content and, when it differs, skips the review and exits 0 — the check reports `success` ' +
          `having reviewed nothing. Diff: \`git diff ${defaultRef} -- ${workflow}\`. Promote the ` +
          'change to the default branch (or revert it here) before relying on the review again.',
      });
    }
  }
  return { findings, checked: workflows, defaultRef };
}

export function main() {
  if (isPromotionToDefault()) {
    process.stdout.write(
      'review-workflow-parity scan: this PR targets the default branch, i.e. it IS the promotion ' +
        'that restores parity — rule not applicable.\n',
    );
    return;
  }

  const { findings, checked, defaultRef } = findReviewWorkflowParityFindings();

  if (checked.length === 0) {
    process.stdout.write(
      'review-workflow-parity scan: no workflow invokes anthropics/claude-code-action — nothing to guard.\n',
    );
    return;
  }

  if (findings.length > 0) {
    process.stdout.write('review-workflow-parity scan failed (INFRA-048):\n');
    for (const finding of findings) {
      process.stdout.write(`  - ${finding.workflow}: ${finding.detail}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `review-workflow-parity scan passed: ${checked.join(', ')} match ${defaultRef}.\n`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

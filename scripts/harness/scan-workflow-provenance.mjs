#!/usr/bin/env node

/**
 * A pull request must not silently edit the workflow that reports its own required check (INFRA-097).
 *
 * THE GAP. A required check triggered by `pull_request` loads its workflow YAML from the PR's merge
 * revision. So the PR carries the control plane that judges it: change the job, change the verdict.
 * INFRA-096 hardened the SCRIPTS those workflows load by checking them out from the base SHA, and
 * recorded plainly that this does not establish workflow provenance — the YAML itself still comes
 * from the PR. This scan closes the part of that gap a repository can close on its own.
 *
 * WHAT IT DOES NOT DO, said first because the alternative is a false sense of a solved problem.
 * It does not make the control plane trusted. A reviewer who approves a self-edit still approves it,
 * and a maintainer can still merge one. Trusted provenance needs a control plane the PR cannot
 * reach at all — an organization-level required workflow, a `pull_request_target` split that never
 * runs PR content with write credentials, or an external app publishing the check. Each needs
 * configuration outside this repository, so each is an owner decision recorded in INFRA-097 rather
 * than something this file can assert. What this scan provides is DETECTION: the edit stops being
 * invisible, and a reviewer is told which required context the change can move.
 *
 * THE CRITERIA ARE READ, NOT COPIED. `.github/required-status-checks.json` is already the SSOT for
 * which contexts each protected branch requires and which workflow file provides each one; two other
 * scans consume it. This one derives the guarded file set from the same place, so adding a required
 * context in a new workflow governs that workflow here with no code change. The parse is
 * FAIL-CLOSED: an unreadable registry, or one naming no workflow, exits 1 — a provenance guard that
 * cannot read which files matter has verified nothing.
 *
 * Usage:
 *   node scripts/harness/scan-workflow-provenance.mjs                 # audit the tree
 *   node scripts/harness/scan-workflow-provenance.mjs --base-ref <r>  # judge a change
 */

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { requireGovernedTree } from './governed-tree.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const REGISTRY_RELATIVE = '.github/required-status-checks.json';

/**
 * Every workflow file that provides a required status check, for any protected branch.
 *
 * Returns `{ workflows, contextsByWorkflow }`. An empty `workflows` is a failure for the caller, not
 * a clean result — see the fail-closed note in the header.
 */
export function readGuardedWorkflows(root = WORKSPACE_ROOT) {
  const file = path.join(root, REGISTRY_RELATIVE);
  if (!existsSync(file)) return { workflows: [], contextsByWorkflow: new Map() };
  const registry = JSON.parse(readFileSync(file, 'utf8'));
  const contextsByWorkflow = new Map();
  for (const [branch, config] of Object.entries(registry.branches ?? {})) {
    for (const check of config.required_status_checks ?? []) {
      if (!check.workflow) continue;
      const entry = contextsByWorkflow.get(check.workflow) ?? [];
      entry.push(`${check.context} (${branch})`);
      contextsByWorkflow.set(check.workflow, entry);
    }
  }
  return { workflows: [...contextsByWorkflow.keys()].sort(), contextsByWorkflow };
}

/**
 * Does this workflow load its definition from the pull request under test?
 *
 * `pull_request` does; `pull_request_target`, `workflow_run` and `schedule` load from the base and
 * are the shapes a trusted design would move toward. Read off the `on:` block only — a job step
 * mentioning the string is not a trigger.
 */
export function triggersFromPullRequest(workflowText) {
  const lines = workflowText.split('\n');
  let inOn = false;
  for (const line of lines) {
    if (/^on:\s*$/.test(line)) {
      inOn = true;
      continue;
    }
    if (inOn && /^\S/.test(line)) break;
    if (inOn && /^\s{2}pull_request:\s*$/.test(line)) return true;
  }
  return false;
}

function changedFiles(root, baseRef) {
  const result = spawnSync('git', ['diff', '--name-only', `${baseRef}...HEAD`], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `workflow-provenance: could not read the diff against \`${baseRef}\` — the measurement ` +
        `FAILED, so no verdict can be reported from it.\n${result.stderr ?? ''}`,
    );
  }
  return result.stdout.split('\n').filter(Boolean);
}

export function findWorkflowProvenanceFindings(root = WORKSPACE_ROOT, baseRef) {
  requireGovernedTree(root, [REGISTRY_RELATIVE], {
    scan: 'workflow-provenance',
    why: 'The registry states which workflows provide a required check; without it there is no guarded set, and "no findings" would mean "nothing was examined".',
  });
  const { workflows, contextsByWorkflow } = readGuardedWorkflows(root);
  if (workflows.length === 0) {
    throw new Error(
      'workflow-provenance: the required-status-check registry names no workflow. The set this ' +
        'scan guards is unreadable, so a pass would assert something it never measured.',
    );
  }

  const findings = [];
  // The standing property, checked on every run: a guarded workflow that loads itself from the PR
  // is the exposure. Reported as the scan's own subject rather than as a per-change finding, so the
  // situation is visible even on a run with no diff.
  const selfLoading = workflows.filter((w) => {
    const file = path.join(root, w);
    return existsSync(file) && triggersFromPullRequest(readFileSync(file, 'utf8'));
  });

  if (baseRef !== undefined) {
    const touched = changedFiles(root, baseRef).filter((f) => workflows.includes(f));
    for (const file of touched) {
      const contexts = contextsByWorkflow.get(file) ?? [];
      findings.push({
        file,
        problem:
          `is edited by this change AND provides required check(s): ${contexts.join(', ')}. ` +
          `Because it is triggered by \`pull_request\`, the edited definition is what will judge ` +
          `this pull request — the change can move its own gate. This is not a refusal to make the ` +
          `edit; it is a refusal to make it INVISIBLY. State in the pull request why the control ` +
          `plane changes, and have a reviewer read the job that reports each context above.`,
      });
    }
  }

  return { findings, workflows, selfLoading, examined: workflows.length };
}

/** Exported so a test can read the size this scan reports (measurement-provenance.md). */
export function readExaminedWorkflowCount(root = WORKSPACE_ROOT) {
  return findWorkflowProvenanceFindings(root).examined;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const baseIndex = process.argv.indexOf('--base-ref');
  const baseRef = baseIndex === -1 ? undefined : process.argv[baseIndex + 1];
  const { findings, workflows, selfLoading, examined } = findWorkflowProvenanceFindings(
    WORKSPACE_ROOT,
    baseRef,
  );
  for (const finding of findings) console.error(`✗ ${finding.file}: ${finding.problem}`);
  if (selfLoading.length > 0) {
    console.error(
      `⚑ ${selfLoading.length} of ${workflows.length} guarded workflow(s) load their definition ` +
        `from the pull request (\`on: pull_request\`): ${selfLoading.join(', ')}. Trusted ` +
        `provenance is an owner decision recorded in INFRA-097; this scan makes an edit visible, ` +
        `it does not make the control plane trusted.`,
    );
  }
  console.log(`::examined:: ${examined} guarded workflow(s)`);
  process.exit(findings.length > 0 ? 1 : 0);
}

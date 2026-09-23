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
import { literalLocalImportClosure } from './literal-local-import-closure.mjs';
import { triggersFromPullRequestTarget } from './scan-pull-request-target-promotion-lag.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const REGISTRY_RELATIVE = '.github/required-status-checks.json';
const TRUSTED_CONTROL_PLANE_ENTRIES = [
  'scripts/harness/scan-workflow-provenance.mjs',
  'scripts/harness/classify-changed-paths.mjs',
  'scripts/harness/product-integration-tests.mjs',
  'scripts/harness/review-verdict-projection.mjs',
  'scripts/harness/harness-test-tiers.mjs',
  'scripts/harness/run-all-scans.mjs',
];
const SECURITY_POLICY_INPUTS = [
  '.gitleaks.toml',
  'osv-scanner.toml',
  'scripts/harness/generate-dependency-review-license-exemptions.mjs',
];
const ACTIONLINT_POLICY_INPUTS = ['.github/actionlint.yaml'];

/**
 * Every workflow file that provides a required status check, directly or through a repository-local
 * reusable workflow, for any protected branch.
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
  const pending = [...contextsByWorkflow.keys()];
  const visited = new Set();
  while (pending.length > 0) {
    const workflow = pending.shift();
    if (visited.has(workflow)) continue;
    visited.add(workflow);
    const workflowFile = path.join(root, workflow);
    if (!existsSync(workflowFile)) continue;
    const source = readFileSync(workflowFile, 'utf8');
    const localUses = [
      ...source.matchAll(/^\s*uses:\s*(\.\/\.github\/workflows\/[^\s#]+)\s*$/gmu),
    ].map((match) => match[1].replace(/^\.\//u, ''));
    for (const dependency of localUses) {
      const contexts = contextsByWorkflow.get(dependency) ?? [];
      for (const context of contextsByWorkflow.get(workflow) ?? []) {
        if (!contexts.includes(context)) contexts.push(context);
      }
      contextsByWorkflow.set(dependency, contexts);
      pending.push(dependency);
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

/**
 * The files a change touches, as NAMES only. Rename detection is deliberately disabled so both
 * sides of a rename are returned. Otherwise Git reports only the destination for `--name-only`,
 * and renaming a guarded workflow would hide the guarded source path from this scan.
 *
 * `headRef` is explicit so this can judge a pull request from a checkout that is NOT the pull
 * request — the trusted-plane guard (INFRA-097) checks out the BASE, fetches the PR head without
 * checking it out, and asks about `FETCH_HEAD`. Reading a name is not running the code that has it,
 * which is the whole property that lets a guard be trusted while its subject is not.
 */
function changedFiles(root, baseRef, headRef = 'HEAD') {
  const result = spawnSync(
    'git',
    ['diff', '--name-only', '--no-renames', `${baseRef}...${headRef}`],
    {
      cwd: root,
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `workflow-provenance: could not read the diff against \`${baseRef}\` — the measurement ` +
        `FAILED, so no verdict can be reported from it.\n${result.stderr ?? ''}`,
    );
  }
  return result.stdout.split('\n').filter(Boolean);
}

export function findWorkflowProvenanceFindings(root = WORKSPACE_ROOT, baseRef, headRef) {
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
  const securityContexts = [
    ...new Set(
      [...contextsByWorkflow.values()].flat().filter((context) => context.startsWith('security (')),
    ),
  ].sort();
  const securityPolicyInputs = securityContexts.length > 0 ? SECURITY_POLICY_INPUTS : [];
  requireGovernedTree(root, securityPolicyInputs, {
    scan: 'workflow-provenance',
    why: 'These files control the verdict of the required security context; if one is absent, the trusted guard cannot establish which policy the pull request executes.',
  });
  const actionlintPolicyInputs = workflows.includes('.github/workflows/ci.yml')
    ? ACTIONLINT_POLICY_INPUTS
    : [];
  requireGovernedTree(root, actionlintPolicyInputs, {
    scan: 'workflow-provenance',
    why: 'The actionlint configuration controls diagnostics in required workflow validation; an absent configuration leaves that policy unverified.',
  });
  const controlPlaneInputs = literalLocalImportClosure(root, TRUSTED_CONTROL_PLANE_ENTRIES);
  requireGovernedTree(root, controlPlaneInputs, {
    scan: 'workflow-provenance',
    why: 'These base-executed modules select or judge required CI work. A trusted guard must protect its own implementation closure and the PR-side selector/scheduler closure from two-PR self-bypass.',
  });
  const guardedInputs = new Set([
    REGISTRY_RELATIVE,
    ...workflows,
    ...securityPolicyInputs,
    ...actionlintPolicyInputs,
    ...controlPlaneInputs,
  ]);

  const findings = [];
  // The standing property, checked on every run: a guarded workflow that loads itself from the PR
  // is the exposure. Reported as the scan's own subject rather than as a per-change finding, so the
  // situation is visible even on a run with no diff.
  const selfLoading = workflows.filter((w) => {
    const file = path.join(root, w);
    return existsSync(file) && triggersFromPullRequest(readFileSync(file, 'utf8'));
  });

  if (baseRef !== undefined) {
    const touched = changedFiles(root, baseRef, headRef).filter((file) => guardedInputs.has(file));
    for (const file of touched) {
      if (file === REGISTRY_RELATIVE) {
        findings.push({
          file,
          problem:
            'is edited by this change AND defines the guarded workflow set. Removing or changing ' +
            'an entry can make a later required-workflow self-edit invisible to this trusted gate. ' +
            'Treat this registry edit as a control-plane change: state why the guarded set changes, ' +
            'have a reviewer compare it with the live ruleset, and use .agents/rules/git-branch.md ' +
            '§ "Landing a control-plane change" for the owner-authorized landing record.',
        });
        continue;
      }
      if (securityPolicyInputs.includes(file)) {
        findings.push({
          file,
          problem:
            `is edited by this change AND controls required check(s): ${securityContexts.join(', ')}. ` +
            'A permissive policy edit can make the security scan green over a secret or accepted ' +
            'vulnerability without changing its guarded workflow. Treat this policy edit as a ' +
            'control-plane change, have a reviewer inspect its verdict effect, and use ' +
            '.agents/rules/git-branch.md § "Landing a control-plane change" for the ' +
            'owner-authorized landing record.',
        });
        continue;
      }
      if (actionlintPolicyInputs.includes(file)) {
        findings.push({
          file,
          problem:
            'is edited by this change AND controls actionlint diagnostics for required workflow ' +
            'validation. A permissive ignore rule can hide errors in a required-check workflow ' +
            'without editing that workflow. Treat this as a control-plane change and review the ' +
            'actionlint and pr-validation jobs before owner-authorized landing.',
        });
        continue;
      }
      if (controlPlaneInputs.includes(file)) {
        findings.push({
          file,
          problem:
            'is edited by this change AND belongs to the trusted required-check implementation or ' +
            'selector/scheduler import closure. A permissive edit can suppress a required verdict ' +
            'in this or a later pull request. Treat this as a control-plane change, have a reviewer ' +
            'inspect the affected required jobs and selection behavior, and use ' +
            '.agents/rules/git-branch.md § "Landing a control-plane change" for the ' +
            'owner-authorized landing record.',
        });
        continue;
      }
      const contexts = contextsByWorkflow.get(file) ?? [];
      const full = path.join(root, file);
      // The two triggers fail in OPPOSITE directions, so one message would be wrong for one of them.
      // `pull_request` loads the edited definition and judges this change with it — the edit is too
      // powerful. `pull_request_target` loads the DEFAULT branch's copy — the edit does nothing at
      // all until a promotion carries it (issue #2039), which is how two verified, green fixes to
      // this repository's own gate were both inert.
      const promoted =
        existsSync(full) && triggersFromPullRequestTarget(readFileSync(full, 'utf8'));
      findings.push({
        file,
        problem: promoted
          ? `is edited by this change AND provides required check(s): ${contexts.join(', ')}. ` +
            `Because it is triggered by \`pull_request_target\`, THIS EDIT DOES NOT TAKE EFFECT ` +
            `until a promotion carries it — the version that runs is the default branch's copy of ` +
            `this file, whatever this change says. Verify the fix against the promoted copy, not ` +
            `against this branch, and say in the pull request that it is not yet live.`
          : `is edited by this change AND provides required check(s): ${contexts.join(', ')}. ` +
            `Because it is triggered by \`pull_request\`, the edited definition is what will judge ` +
            `this pull request — the change can move its own gate. This is not a refusal to make the ` +
            `edit; it is a refusal to make it INVISIBLY. State in the pull request why the control ` +
            `plane changes, and have a reviewer read the job that reports each context above. The ` +
            `landing procedure — who approves, what they confirm, how it merges over this red ` +
            `context, what is recorded — is .agents/rules/git-branch.md § "Landing a control-plane ` +
            `change" (issue #2256).`,
      });
    }
  }

  return { findings, workflows, selfLoading, examined: guardedInputs.size };
}

/** Exported so a test can read the size this scan reports (measurement-provenance.md). */
export function readExaminedWorkflowCount(root = WORKSPACE_ROOT) {
  return findWorkflowProvenanceFindings(root).examined;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const argAfter = (flag) => {
    const at = process.argv.indexOf(flag);
    return at === -1 ? undefined : process.argv[at + 1];
  };
  const baseRef = argAfter('--base-ref');
  const headRef = argAfter('--head-ref');
  const { findings, workflows, selfLoading, examined } = findWorkflowProvenanceFindings(
    WORKSPACE_ROOT,
    baseRef,
    headRef,
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
  console.log(`::examined:: ${examined} guarded control-plane input(s)`);
  process.exit(findings.length > 0 ? 1 : 0);
}

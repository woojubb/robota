#!/usr/bin/env node

/**
 * Auto-merge mutation permission guard (INFRA-057).
 *
 * A workflow job that enables or disables a pull request's auto-merge calls GitHub's
 * `enablePullRequestAutoMerge` / `disablePullRequestAutoMerge` GraphQL mutations — through `gh pr
 * merge --auto` / `--disable-auto` or directly. Those are a MERGE capability, not a PR-metadata one:
 * they need `contents: write` in addition to `pull-requests: write`.
 *
 * The failure is silent, which is why it needs a mechanical floor. Measured on #1461 and again on
 * the throwaway #1465, from `review-gate`'s own log, with auto-merge verifiably armed:
 *
 *     GraphQL: Resource not accessible by integration (disablePullRequestAutoMerge)
 *     auto-merge was not armed; nothing to disarm.
 *
 * The job held `contents: read`. Nothing was red, nothing was annotated, and the one line the log
 * did print said the opposite of what had happened. INFRA-048 had budgeted for that disarm as its
 * lever against an armed auto-merge outrunning the review loop (#1409), and it had never once
 * fired. A lever believed to work and silently missing its scope is worse than a missing one.
 *
 * Two rules, both mechanical:
 *
 *   1. A job that performs an auto-merge mutation must hold BOTH `contents: write` and
 *      `pull-requests: write` in its EFFECTIVE permissions (job-level block if present, otherwise
 *      the workflow-level one — a job-level block REPLACES the workflow-level one entirely).
 *   2. In a workflow triggered by `pull_request` / `pull_request_target`, that job must not check
 *      the repository out. `contents: write` plus a checkout of the pull request means a write
 *      token in the same job as PR-authored code, which is the standard supply-chain hole. Split
 *      the mutation into its own job — the reason `review-gate.yml` has `disarm-auto-merge`.
 *
 * Exit code 0 = every auto-merge mutation runs with the scope it needs, 1 = violation found.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { listWorkflows, splitWorkflowJobs, stripComments } from './scan-ci-base-history.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

/** Scopes an auto-merge mutation needs. `pull-requests` alone is not enough — that was the defect. */
export const REQUIRED_SCOPES = ['contents', 'pull-requests'];

/**
 * How a job text reveals that it performs an auto-merge mutation. `--disable-auto` does not contain
 * the token `--auto`, so the two patterns do not shadow each other.
 */
export const AUTOMERGE_MUTATION_SIGNALS = [
  { name: 'gh pr merge --disable-auto', pattern: /\bgh\s+pr\s+merge\b[^\n]*--disable-auto\b/ },
  { name: 'gh pr merge --auto', pattern: /\bgh\s+pr\s+merge\b[^\n]*--auto\b/ },
  { name: 'disablePullRequestAutoMerge', pattern: /\bdisablePullRequestAutoMerge\b/ },
  { name: 'enablePullRequestAutoMerge', pattern: /\benablePullRequestAutoMerge\b/ },
];

/**
 * Whether a workflow is triggered by pull-request events, i.e. can run PR-authored code.
 * Read from the `on:` BLOCK only — a `pull_request` mentioned in a `run:` body further down is not
 * a trigger, and treating it as one would apply the checkout rule to workflows it does not govern.
 */
export function isPullRequestTriggered(yamlText) {
  const lines = stripComments(yamlText).split(/\r?\n/);
  const onIndex = lines.findIndex((line) => /^on:/.test(line));
  if (onIndex === -1) return false;
  const block = [lines[onIndex]];
  for (const line of lines.slice(onIndex + 1)) {
    if (line.trim() !== '' && /^\S/.test(line)) break; // next top-level key ends `on:`
    block.push(line);
  }
  return /\b(pull_request|pull_request_target)\b/.test(block.join('\n'));
}

/**
 * Parse a `permissions:` block that starts at `startLine` with keys indented by `keyIndent`.
 * Returns a `{ scope: level }` map, or `'all-write'` / `'all-read'` for the scalar shorthands.
 */
function parsePermissionsAt(lines, startLine, keyIndent) {
  const scalar = /^\s*permissions:\s*(\S.*)$/.exec(lines[startLine]);
  if (scalar) {
    const value = scalar[1].trim();
    if (value === 'write-all') return 'all-write';
    if (value === 'read-all') return 'all-read';
    if (value === '{}') return {};
    return {};
  }
  const permissions = {};
  const keyPattern = new RegExp(`^ {${keyIndent}}([a-z-]+):\\s*(\\S+)\\s*$`);
  for (const line of lines.slice(startLine + 1)) {
    if (line.trim() === '') continue;
    const match = keyPattern.exec(line);
    if (!match) break;
    permissions[match[1]] = match[2];
  }
  return permissions;
}

/** The workflow-level `permissions:` block, or `null` when the file declares none. */
export function workflowPermissions(yamlText) {
  const lines = stripComments(yamlText).split(/\r?\n/);
  const index = lines.findIndex((line) => /^permissions:/.test(line));
  if (index === -1) return null;
  return parsePermissionsAt(lines, index, 2);
}

/** A job's own `permissions:` block, or `null` when the job declares none. */
export function jobPermissions(jobText) {
  const lines = stripComments(jobText).split(/\r?\n/);
  const index = lines.findIndex((line) => /^ {4}permissions:/.test(line));
  if (index === -1) return null;
  return parsePermissionsAt(lines, index, 6);
}

/** The scopes a job actually runs with: its own block if it has one, otherwise the workflow's. */
export function effectivePermissions(yamlText, jobText) {
  return jobPermissions(jobText) ?? workflowPermissions(yamlText) ?? null;
}

/** Required scopes the effective permissions do NOT grant at `write`. */
export function missingScopes(permissions) {
  if (permissions === 'all-write') return [];
  if (permissions === null) {
    // No declaration anywhere: the token falls back to the repository default, which is a setting
    // this scan cannot read and an administrator can flip. Not a scope a merge lever may rest on.
    return [...REQUIRED_SCOPES];
  }
  if (permissions === 'all-read') return [...REQUIRED_SCOPES];
  return REQUIRED_SCOPES.filter((scope) => permissions[scope] !== 'write');
}

/** The mutation signals present in a job. */
export function automergeSignals(jobText) {
  const text = stripComments(jobText);
  return AUTOMERGE_MUTATION_SIGNALS.filter((signal) => signal.pattern.test(text)).map(
    (signal) => signal.name,
  );
}

/** Whether a job checks the repository out (`actions/checkout`, or a raw `git clone`). */
export function checksOutRepository(jobText) {
  return /\bactions\/checkout\b|\bgit\s+clone\b/.test(stripComments(jobText));
}

/** Findings across every workflow. */
export function findAutomergePermissionFindings(root = WORKSPACE_ROOT) {
  const findings = [];
  for (const workflow of listWorkflows(root)) {
    const filePath = path.join(root, workflow);
    if (!existsSync(filePath)) continue;
    const text = readFileSync(filePath, 'utf8');
    const prTriggered = isPullRequestTriggered(text);
    for (const job of splitWorkflowJobs(text)) {
      const signals = automergeSignals(job.text);
      if (signals.length === 0) continue;
      const missing = missingScopes(effectivePermissions(text, job.text));
      if (missing.length > 0) {
        findings.push({
          workflow,
          job: job.name,
          detail:
            `performs an auto-merge mutation (${signals.join(', ')}) without ` +
            `${missing.map((scope) => `\`${scope}: write\``).join(' and ')} in its effective ` +
            'permissions. GitHub answers `Resource not accessible by integration` and `gh` exits ' +
            'non-zero — a failure that is easy to swallow and easy to misread.',
        });
      }
      if (prTriggered && checksOutRepository(job.text)) {
        findings.push({
          workflow,
          job: job.name,
          detail:
            `performs an auto-merge mutation (${signals.join(', ')}) in a job that CHECKS THE ` +
            'REPOSITORY OUT, in a pull-request-triggered workflow. That job needs `contents: ' +
            'write`, and it would hold that token while running code authored by the pull ' +
            'request. Move the mutation into its own job that checks nothing out.',
        });
      }
    }
  }
  return findings;
}

export async function main() {
  const findings = findAutomergePermissionFindings();
  if (findings.length > 0) {
    process.stdout.write('automerge-disarm-permission scan failed (INFRA-057):\n');
    for (const finding of findings) {
      process.stdout.write(`  - ${finding.workflow} › ${finding.job}: ${finding.detail}\n`);
    }
    process.stdout.write(
      'An auto-merge mutation that is not permitted fails SILENTLY: the merge stays armed while the\n' +
        'workflow reports whatever its fallback prints. See INFRA-057.\n',
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`::examined:: ${listWorkflows().length} workflows\n`);
  process.stdout.write('automerge-disarm-permission scan passed.\n');
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  await main();
}

#!/usr/bin/env node

/**
 * Review-token-supply guard (INFRA-062, successor to INFRA-048's `scan-review-workflow-parity`).
 *
 * WITHOUT a `github_token` input, `anthropics/claude-code-action` mints its GitHub App token via an
 * OIDC exchange that validates the invoking workflow file BYTE-FOR-BYTE against the repository's
 * default branch. On any divergence it prints
 *
 *     Skipping action due to workflow validation: …
 *     Exiting due to workflow validation skip
 *
 * and **exits 0** — the job reports `success` having reviewed nothing. That silent skip ran 100
 * consecutive times on this repo (INFRA-048), and the parity scan built to detect it created a
 * guard deadlock with `scan-promotion-ancestry`: `claude-code-review.yml` became unmodifiable
 * through any CI-green route (INFRA-062).
 *
 * INFRA-062 removed the CAUSE instead of detecting the symptom: supplying `github_token` makes
 * `setupGitHubToken()` return the provided token BEFORE the OIDC exchange — verified in
 * `src/github/token.ts` at v1.0.183, the commit `anthropics/claude-code-action@v1` resolves to,
 * where the exchange (`exchangeForAppToken`) is the only site that can throw the
 * workflow-validation skip. With the input present the skip path is unreachable code.
 *
 * That deletion is only safe while the input stays. This scan is the anti-rot floor: every
 * workflow that invokes the action MUST supply a non-empty `github_token` in the step's `with:`
 * block. Drop the input and the silent-skip failure mode returns — with nothing left to detect it,
 * because the parity scan is gone. Hence this fails the required `scans` job instead.
 *
 * Exit code 0 = every governed step supplies `github_token`, 1 = at least one does not.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const WORKFLOW_DIR = path.join('.github', 'workflows');

/** The action whose token-less OIDC exchange makes the `github_token` input load-bearing. */
/**
 * How many workflow files the last walk actually READ.
 *
 * A module-level holder rather than a widened return: the finder's shape is asserted by its own
 * cases (HARNESS-057). RESET at the top of the walk, so a run that reads nothing cannot report the
 * previous run's number.
 */
let examinedCount = 0;

export function readExamined() {
  return examinedCount;
}

export const VALIDATED_ACTION_PATTERN = /anthropics\/claude-code-action/;

/** Workflow files (repo-relative) that invoke the validated action. Discovered, never hardcoded. */
export function listGovernedWorkflows(root = WORKSPACE_ROOT) {
  const dir = path.join(root, WORKFLOW_DIR);
  // FAIL-CLOSED (HARNESS-052, inherited from the scan this one replaces). Returning `[]` here would
  // make `main()` print "nothing to guard" and exit 0 — this scan, whose entire subject is an action
  // that skips and exits 0, doing the same thing.
  if (!existsSync(dir))
    throw new Error(
      `${WORKFLOW_DIR} does not exist under ${root}. This scan will not report a pass over a ` +
        'directory it could not read.',
    );
  return readdirSync(dir)
    .filter((entry) => /\.ya?ml$/.test(entry))
    .sort()
    .map((entry) => path.join(WORKFLOW_DIR, entry))
    .filter((relPath) =>
      VALIDATED_ACTION_PATTERN.test(readFileSync(path.join(root, relPath), 'utf8')),
    );
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

/**
 * Does this trimmed line supply a `github_token` with a value that can actually authenticate?
 *
 * `action.yml` maps the input straight to `OVERRIDE_GITHUB_TOKEN`, and `setupGitHubToken()` gates on
 * its TRUTHINESS (`if (providedToken)`), so any value YAML resolves to empty falls through to the
 * OIDC exchange — exactly the silent-skip path this scan exists to keep unreachable. So "there are
 * some characters after the colon" is the wrong question; "does YAML resolve this to a non-empty
 * scalar" is the right one.
 *
 * The live reviewer caught this twice on this scan's own PR, both times correctly:
 *   1. `github_token: ''` — the quote IS non-whitespace, so a bare `\S` test passed it.
 *   2. `github_token: # TODO fill in` — YAML resolves that to null, but a naive capture of
 *      everything after the colon sees the COMMENT as the value and passes it.
 * Both are the guard's own bypass, and a guard its own bypass passes is not a guard.
 */
export function hasNonEmptyTokenValue(trimmed) {
  const match = /^github_token:\s*(.*)$/.exec(trimmed);
  if (match === null) return false;
  const raw = match[1].trim();

  // A quoted scalar owns everything up to its closing quote; anything after it is a comment.
  const quoted = /^(['"])((?:[^'"]|(?!\1)['"])*)\1/.exec(raw);
  if (quoted !== null) return quoted[2].trim().length > 0;

  // Unquoted: `#` opens a YAML comment when it starts the value or follows whitespace.
  return raw.replace(/(^|\s)#.*$/, '').trim().length > 0;
}

/**
 * Every `uses: …anthropics/claude-code-action…` step in `content` must carry a non-empty
 * `github_token:` entry in the step's `with:` block.
 *
 * Structural, not a YAML parse: the step's block ends at the first non-blank, non-comment line
 * that is either shallower than the `uses:` line, or a new list item (`- `) at the same depth.
 * That covers both step shapes — `- uses:` (siblings one level deeper than the dash) and
 * `- name:` + `uses:` (siblings at the same depth, next step's dash shallower). The token only
 * counts inside a `with:` mapping of that step, so a stray `github_token` under `env:` cannot
 * satisfy the guard.
 *
 * @returns {Array<{line: number, detail: string}>} one finding per token-less step
 */
export function findTokenlessActionSteps(content) {
  const lines = content.split('\n');
  const findings = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!VALIDATED_ACTION_PATTERN.test(line) || !/^\s*-?\s*uses:/.test(line)) continue;

    const usesIndent = indentOf(line);
    let hasToken = false;
    let withIndent;
    for (let j = i + 1; j < lines.length; j += 1) {
      const candidate = lines[j];
      const trimmed = candidate.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;
      const indent = indentOf(candidate);
      if (indent < usesIndent) break;
      if (trimmed.startsWith('- ') && indent <= usesIndent) break;
      if (withIndent !== undefined && indent <= withIndent) withIndent = undefined;
      if (withIndent === undefined && /^with:\s*$/.test(trimmed)) {
        withIndent = indent;
        continue;
      }
      if (withIndent !== undefined && hasNonEmptyTokenValue(trimmed)) {
        hasToken = true;
        break;
      }
    }
    if (!hasToken) {
      findings.push({
        line: i + 1,
        detail:
          'invokes anthropics/claude-code-action WITHOUT a `github_token` input. Token-less, the ' +
          'action authenticates via an OIDC exchange that validates this workflow byte-for-byte ' +
          'against the default branch and SILENTLY SKIPS the review (exit 0) on any divergence — ' +
          'the INFRA-048 failure mode, whose detector was retired when this input made it ' +
          'unreachable (INFRA-062). Supply `github_token: ${{ secrets.GITHUB_TOKEN }}` on the step.',
      });
    }
  }
  return findings;
}

/**
 * @returns {{findings: Array<{workflow: string, line: number, detail: string}>, checked: string[]}}
 */
export function findReviewTokenSupplyFindings(root = WORKSPACE_ROOT) {
  examinedCount = 0;
  const workflows = listGovernedWorkflows(root);
  // ANTI-ROT (HARNESS-052, inherited). An empty governed set is not a pass: the day the action
  // reference is renamed, wrapped in a composite action, or pinned under another org, this guard
  // would print "nothing to guard" and pass forever — while the reviewer went back to being a job
  // that reports `success` having reviewed nothing. If this repository stops invoking the action,
  // delete this scan deliberately; do not let it decay into a no-op.
  if (workflows.length === 0) {
    return {
      findings: [
        {
          workflow: `(${WORKFLOW_DIR})`,
          line: 0,
          detail:
            `no workflow invokes ${VALIDATED_ACTION_PATTERN.source}. This scan governs an empty ` +
            'set, which is not a pass — either the action reference changed spelling (update ' +
            'VALIDATED_ACTION_PATTERN) or the repository no longer uses it (delete this scan).',
        },
      ],
      checked: [],
    };
  }
  const findings = [];
  for (const workflow of workflows) {
    examinedCount += 1;
    const content = readFileSync(path.join(root, workflow), 'utf8');
    for (const finding of findTokenlessActionSteps(content)) {
      findings.push({ workflow, ...finding });
    }
  }
  return { findings, checked: workflows };
}

export function main() {
  const { findings, checked } = findReviewTokenSupplyFindings();

  // Before the branch, so the size is reported whichever way the verdict goes. Placed inside the
  // failure arm it would have been absent from every passing run — which is every run this scan has
  // ever had, so the marker would have looked present and never appeared.
  process.stdout.write(`::examined:: ${examinedCount} workflow files\n`);

  if (findings.length > 0) {
    process.stdout.write('review-token-supply scan failed:\n');
    for (const finding of findings) {
      process.stdout.write(`  - ${finding.workflow}:${finding.line}: ${finding.detail}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `review-token-supply scan passed: every claude-code-action step in ${checked.join(', ')} ` +
      'supplies github_token.\n',
  );
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}

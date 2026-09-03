#!/usr/bin/env node

/**
 * CI base-history guard (INFRA-050).
 *
 * A workflow job that reads git history RELATIVE TO THE BASE BRANCH — a diff, a `rev-list`, a
 * `merge-base`, a `--log-opts` range, a `--base-ref` — is only correct over COMPLETE ancestry.
 * `git fetch … --depth=N` GRAFTS the whole repository: it marks commits as parentless, so every
 * later traversal (on BOTH sides of the range) stops there. INFRA-049 measured the consequence on
 * PR #1415 — the same command over the same branch saw 109 commits locally and 97, a DIFFERENT
 * set, in CI.
 *
 * The failure is silent, which is why it needs a mechanical floor rather than a review habit:
 * `changes` decides whether `tui-e2e` / `examples-typecheck` / `windows-shell` run, all of them
 * REQUIRED status checks. When its merge base becomes unreachable the job errors, its dependents
 * report `skipping`, and GitHub accepts a skipped required check — so a code PR merges having
 * never been built or tested, with nothing red on the PR.
 *
 * Three rules, all mechanical:
 *
 *   1. No `git fetch … --depth` / `--shallow-since` / `--shallow-exclude` in any workflow. The
 *      graft is repository-wide, so even a job that "only" wanted a cheap base ref corrupts every
 *      history read that follows it in the same checkout.
 *   2. A job that reads base-relative history must check out with `fetch-depth: 0`.
 *   3. (issue #2412) A job in a `pull_request`-triggered workflow that runs a PER-COMMIT history
 *      consumer must export `PR_HEAD_SHA`. On that event `actions/checkout` leaves HEAD at the
 *      synthetic `refs/pull/N/merge`, whose first parent is the base, so a range ending at HEAD is
 *      not the pull request's commits. `resolveHeadSha` in `shared.mjs` owns reading it.
 *
 * Findings are reported per job with the signal that classified it, so the fix is unambiguous.
 *
 * Exit code 0 = no workflow can read history over a grafted/shallow ancestry, 1 = violation found.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const WORKFLOW_DIR = path.join('.github', 'workflows');

/** A depth-limited fetch: the graft itself. Banned outright in workflows. */
export const SHALLOW_FETCH_PATTERN =
  /\bgit\s+fetch\b[^\n]*?(--depth\b|--shallow-(since|exclude)\b)/;

/**
 * Textual signals that a job reads git history relative to the base branch. Deliberately narrow —
 * a bare `github.base_ref` (used by nearly every `if:` in ci.yml) is NOT a signal; a base ref used
 * as a git REVISION is.
 */
export const BASE_HISTORY_SIGNALS = [
  { name: 'origin/<base> revision', pattern: /origin\/\$\{\{\s*github\.base_ref\s*\}\}/ },
  { name: 'origin/$BASE_REF revision', pattern: /origin\/\$\{?BASE_REF\}?/ },
  { name: '--base-ref', pattern: /--base-ref\b/ },
  { name: '--log-opts range', pattern: /--log-opts\b/ },
  { name: 'git merge-base', pattern: /\bgit\s+merge-base\b/ },
  { name: 'git rev-list', pattern: /\bgit\s+rev-list\b/ },
];

/**
 * Invocations that reach a base-history read INDIRECTLY, through a script the job text does not
 * spell the range in. Each entry names the script that performs the read; if that script stops
 * reading base history the entry is stale and this scan fails loudly rather than quietly guarding
 * nothing (anti-rot).
 */
export const BASE_HISTORY_INVOCATIONS = [
  {
    name: 'check-regression-red-proof.mjs',
    pattern: /check-regression-red-proof\.mjs/,
    script: 'scripts/harness/check-regression-red-proof.mjs',
  },
  {
    name: 'check-patch-coverage.mjs',
    pattern: /check-patch-coverage\.mjs/,
    script: 'scripts/harness/check-patch-coverage.mjs',
  },
  {
    name: 'pnpm harness:scan / harness:verify (document-authority gate)',
    pattern: /\bpnpm\s+harness:(scan|verify)/,
    script: 'scripts/harness/check-document-authority.mjs',
  },
  {
    name: 'scan-promotion-ancestry.mjs (INFRA-051 promotion gate)',
    pattern: /scan-promotion-ancestry\.mjs/,
    script: 'scripts/harness/scan-promotion-ancestry.mjs',
  },
];

/** How a script proves it still reads base-relative history. */
const BASE_HISTORY_READ = /merge-base|\.\.\.?HEAD/;

/**
 * Invocations that walk the range COMMIT BY COMMIT (issue #2412). A base-relative diff survives the
 * synthetic merge ref by accident (`diff-tree` suppresses merge diffs); a per-commit walk does not —
 * it ends at whatever HEAD is, and under `pull_request` that is `refs/pull/N/merge`. Each of these
 * therefore needs the pull request's head handed to it as `PR_HEAD_SHA`.
 */
export const PER_COMMIT_HISTORY_INVOCATIONS = [
  {
    name: 'pnpm harness:scan / harness:verify (user-execution-plan-order, promotion-ancestry)',
    pattern: /\bpnpm\s+harness:(?:scan|verify)(?::release)?(?![\w-]*:)/,
  },
  { name: 'scan-promotion-ancestry.mjs', pattern: /scan-promotion-ancestry\.mjs/ },
  { name: 'check-regression-red-proof.mjs', pattern: /check-regression-red-proof\.mjs/ },
];

/** The env key a job exports to name the pull request's head; `resolveHeadSha` reads it. */
export const HEAD_SHA_EXPORT = /^\s+PR_HEAD_SHA:\s*\S/m;

/** Does the workflow run on a pull_request event? Read from the trigger block above `jobs:`. */
export function triggersOnPullRequest(yamlText) {
  const text = stripComments(yamlText);
  const jobsIndex = text.search(/^jobs:\s*$/m);
  const triggers = jobsIndex === -1 ? text : text.slice(0, jobsIndex);
  return /(^|[\s\[,])pull_request(?:_target)?\b/.test(triggers);
}

/** The per-commit invocations a job text performs. */
export function perCommitSignals(jobText) {
  const text = stripComments(jobText);
  return PER_COMMIT_HISTORY_INVOCATIONS.filter((invocation) => invocation.pattern.test(text)).map(
    (invocation) => invocation.name,
  );
}

/** Does the job export `PR_HEAD_SHA` (outside comments)? */
export function exportsHeadSha(jobText) {
  return HEAD_SHA_EXPORT.test(stripComments(jobText));
}

/**
 * Drop whole-line comments (YAML `#` and the shell `#` inside `run:` blocks alike). Without this a
 * comment EXPLAINING the banned pattern — as ci.yml's commitlint job does, verbatim — trips the very
 * guard it documents.
 */
export function stripComments(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

/** Split a workflow's text into `{ name, text }` blocks, one per job under the top-level `jobs:`. */
export function splitWorkflowJobs(yamlText) {
  const lines = String(yamlText ?? '').split(/\r?\n/);
  const jobsIndex = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (jobsIndex === -1) return [];
  const jobs = [];
  let current = null;
  for (const line of lines.slice(jobsIndex + 1)) {
    if (/^\S/.test(line) && line.trim() !== '') break; // next top-level key ends `jobs:`
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) {
      current = { name: header[1], lines: [] };
      jobs.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return jobs.map((job) => ({ name: job.name, text: job.lines.join('\n') }));
}

/** Every `fetch-depth:` value declared inside a job block, in order. */
export function fetchDepths(jobText) {
  return [...stripComments(jobText).matchAll(/fetch-depth:\s*(\d+)/g)].map((match) => match[1]);
}

/** The signals (direct + indirect) that classify a job as reading base-relative history. */
export function baseHistorySignals(jobText) {
  const text = stripComments(jobText);
  return [
    ...BASE_HISTORY_SIGNALS.filter((signal) => signal.pattern.test(text)),
    ...BASE_HISTORY_INVOCATIONS.filter((invocation) => invocation.pattern.test(text)),
  ].map((signal) => signal.name);
}

/** Entries in BASE_HISTORY_INVOCATIONS whose backing script no longer reads base history. */
export function staleInvocations(root = WORKSPACE_ROOT) {
  return BASE_HISTORY_INVOCATIONS.filter((invocation) => {
    const scriptPath = path.join(root, invocation.script);
    if (!existsSync(scriptPath)) return true;
    return !BASE_HISTORY_READ.test(readFileSync(scriptPath, 'utf8'));
  }).map((invocation) => invocation.script);
}

/** List the workflow files this scan governs. */
export function listWorkflows(root = WORKSPACE_ROOT) {
  const dir = path.join(root, WORKFLOW_DIR);
  // FAIL-CLOSED (HARNESS-052). This returned `[]` when the directory was absent, so every scan
  // built on it — this one, the auto-merge permission guard — reported `scan passed` having read no
  // workflow at all. "There is nothing to check" and "I could not find what I check" are the same
  // value, and that conflation IS the defect this family of scans exists to catch. An absent or
  // empty workflow directory is a broken checkout, never a clean one.
  if (!existsSync(dir))
    throw new Error(
      `${WORKFLOW_DIR} does not exist under ${root}. This scan will not report a pass over a ` +
        'directory it could not read.',
    );
  const workflows = readdirSync(dir)
    .filter((entry) => /\.ya?ml$/.test(entry))
    .sort()
    .map((entry) => path.join(WORKFLOW_DIR, entry));
  if (workflows.length === 0)
    throw new Error(
      `${WORKFLOW_DIR} contains no workflow files under ${root}. A guard with an empty subject ` +
        'reports a pass it did not compute.',
    );
  return workflows;
}

/** Findings across every workflow: grafting fetches, and base-history jobs on a shallow checkout. */
export function findBaseHistoryFindings(root = WORKSPACE_ROOT) {
  const findings = [];
  for (const workflow of listWorkflows(root)) {
    const text = readFileSync(path.join(root, workflow), 'utf8');
    const jobs = splitWorkflowJobs(text);
    if (jobs.length === 0) {
      findings.push({
        workflow,
        job: '(file)',
        detail: 'no parseable `jobs:` block — this scan cannot guard a workflow it cannot read.',
      });
      continue;
    }
    const onPullRequest = triggersOnPullRequest(text);
    for (const job of jobs) {
      // Rule 3 (issue #2412): a per-commit walk under pull_request must be told which head it ends at.
      const perCommit = onPullRequest ? perCommitSignals(job.text) : [];
      if (perCommit.length > 0 && !exportsHeadSha(job.text)) {
        findings.push({
          workflow,
          job: job.name,
          detail:
            `runs a per-commit history scan (${perCommit.join(', ')}) in a pull_request workflow ` +
            'but exports no `PR_HEAD_SHA` — on that event HEAD is the synthetic refs/pull/N/merge, ' +
            'whose first parent is the base. Add `PR_HEAD_SHA: ${{ github.event.pull_request.head.sha }}` to the step env.',
        });
      }
      if (SHALLOW_FETCH_PATTERN.test(stripComments(job.text))) {
        findings.push({
          workflow,
          job: job.name,
          detail:
            'runs a depth-limited `git fetch` (--depth/--shallow-*). A depth fetch GRAFTS the whole ' +
            'repository and truncates ancestry that `actions/checkout` already fetched — drop it and ' +
            'check out with `fetch-depth: 0`.',
        });
      }
      const signals = baseHistorySignals(job.text);
      if (signals.length === 0) continue;
      const depths = fetchDepths(job.text);
      const shallow = depths.filter((depth) => depth !== '0');
      if (depths.length === 0) {
        findings.push({
          workflow,
          job: job.name,
          detail: `reads base-relative history (${signals.join(', ')}) but declares no \`fetch-depth\` — set \`fetch-depth: 0\`.`,
        });
      } else if (shallow.length > 0) {
        findings.push({
          workflow,
          job: job.name,
          detail: `reads base-relative history (${signals.join(', ')}) on a shallow checkout (fetch-depth: ${shallow.join(', ')}) — set \`fetch-depth: 0\`.`,
        });
      }
    }
  }
  return findings;
}

export async function main() {
  const stale = staleInvocations();
  if (stale.length > 0) {
    process.stdout.write(
      'ci-base-history scan failed — BASE_HISTORY_INVOCATIONS is stale; these scripts no longer read base-relative history:\n',
    );
    for (const script of stale) process.stdout.write(`  - ${script}\n`);
    process.stdout.write(
      'Remove the entry (or point it at the script that reads the range) so the guard keeps guarding something real.\n',
    );
    process.exitCode = 1;
    return;
  }

  const findings = findBaseHistoryFindings();
  if (findings.length > 0) {
    process.stdout.write('ci-base-history scan failed (INFRA-050):\n');
    for (const finding of findings) {
      process.stdout.write(`  - ${finding.workflow} › ${finding.job}: ${finding.detail}\n`);
    }
    process.stdout.write(
      'A base-relative history read over a grafted ancestry fails SILENTLY: `changes` gates required\n' +
        'checks, and a skipped required check is accepted by branch protection.\n',
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`::examined:: ${listWorkflows().length} workflows\n`);
  process.stdout.write('ci-base-history scan passed.\n');
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  await main();
}

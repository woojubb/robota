#!/usr/bin/env node

/**
 * How many of the ACCOUNT'S shared job slots one push takes.
 *
 * Concurrent GitHub-hosted jobs are budgeted per ACCOUNT, not per repository, and the ceiling is
 * small (tens of jobs). Every job this repository dispatches therefore occupies a slot that every
 * other repository on the same account — including ones that pay for their minutes — must then wait
 * for. A repository whose own minutes are free is not free of this cost: it spends the shared
 * resource at full price.
 *
 * That makes JOB COUNT the number to govern, and it is governed here as a ratchet rather than a
 * limit picked from the air: the count may fall and must never rise without a re-freeze, so adding a
 * job is a decision someone makes on purpose and reviews, not a drift nobody notices.
 *
 * It is also the number that governs cost wherever minutes ARE billed, because billing rounds each
 * job up to a whole minute — twenty ten-second jobs cost twenty minutes. The two concerns point at
 * the same lever.
 *
 * A SUPERSEDED RUN STILL HOLDS ITS SLOTS, which is why every workflow a pull request can trigger must
 * also declare `concurrency` with `cancel-in-progress`. Without it, a rapid re-push doubles the
 * footprint while the first run finishes work whose answer is already stale.
 *
 * WHAT IT COUNTS: jobs declared by workflows a `pull_request` event can trigger. That is an UPPER
 * BOUND — conditions and path gates mean fewer usually start — and an upper bound is the right thing
 * to freeze, because it is what the account must be able to absorb in the worst case.
 *
 * Exit code 0 = at or under the frozen footprint with every trigger guarded, 1 = otherwise.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const WORKFLOW_DIR = '.github/workflows';
const BASELINE_PATH = path.join(WORKSPACE_ROOT, 'scripts/harness/ci-footprint-baseline.json');

/** Minimal reader for the two shapes this needs; a full YAML parser is not a harness dependency. */
export function readWorkflowFacts(source) {
  const jobs = [];
  let inJobs = false;
  let triggersPullRequest = false;
  let hasConcurrency = false;
  let cancelInProgress = false;
  for (const raw of source.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (/^\s*#/.test(line)) continue;
    if (/^on:/.test(line)) inJobs = false;
    if (/^\s{2}pull_request:/.test(line)) triggersPullRequest = true;
    if (/^concurrency:/.test(line)) hasConcurrency = true;
    if (/^\s+cancel-in-progress:\s*true/.test(line)) cancelInProgress = true;
    if (/^jobs:/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    if (/^\S/.test(line)) {
      inJobs = false;
      continue;
    }
    const job = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (job) jobs.push(job[1]);
  }
  return { jobs, triggersPullRequest, hasConcurrency, cancelInProgress };
}

export function findFootprint(root = WORKSPACE_ROOT) {
  const dir = path.join(root, WORKFLOW_DIR);
  if (!existsSync(dir)) {
    // Fail closed: a footprint measured over no workflows is not a small footprint.
    throw new Error(
      `ci-footprint: ${WORKFLOW_DIR} does not exist under ${root} — no workflow could be read.`,
    );
  }
  const findings = [];
  const perWorkflow = {};
  let jobs = 0;
  const files = readdirSync(dir).filter((name) => /\.ya?ml$/.test(name));
  for (const name of files) {
    const facts = readWorkflowFacts(readFileSync(path.join(dir, name), 'utf8'));
    if (!facts.triggersPullRequest) continue;
    perWorkflow[name] = facts.jobs.length;
    jobs += facts.jobs.length;
    if (!facts.hasConcurrency || !facts.cancelInProgress) {
      findings.push({
        kind: 'unguarded-trigger',
        file: name,
        detail:
          'a pull-request workflow without `concurrency` + `cancel-in-progress`: a superseded run ' +
          'keeps its slots, so a rapid re-push doubles the footprint.',
      });
    }
  }
  return { jobs, perWorkflow, findings, examined: files.length };
}

function loadBaseline() {
  return existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : undefined;
}

function main() {
  const { jobs, perWorkflow, findings, examined } = findFootprint();
  const baseline = loadBaseline();

  for (const finding of findings) {
    console.error(`- [${finding.kind}] ${finding.file}: ${finding.detail}`);
  }

  if (baseline === undefined) {
    console.error('ci-footprint: no frozen baseline — run --write-baseline.');
    process.exitCode = 1;
    return;
  }
  if (jobs > baseline.jobs) {
    console.error(
      `\nci-footprint GREW: ${jobs} job(s) per pull request, up from a frozen ${baseline.jobs}. ` +
        'Concurrent jobs are budgeted per ACCOUNT, so each added job is a slot taken from every other ' +
        'repository on it — including ones that pay. Remove a job, merge two, or re-freeze ' +
        'deliberately with --write-baseline.',
    );
    process.exitCode = 1;
    return;
  }
  if (jobs < baseline.jobs) {
    console.error(
      `\nci-footprint FELL (${baseline.jobs} → ${jobs}). Re-freeze it in the SAME change — ` +
        '--write-baseline — or the gain is a licence to grow back.',
    );
    process.exitCode = 1;
    return;
  }
  if (findings.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log(`::examined:: ${examined} pull-request workflows`);
  console.log(
    `ci-footprint scan passed (${examined} workflow(s) examined; ${jobs} job(s) per pull request ` +
      `at baseline, across ${Object.keys(perWorkflow).length} triggered workflow(s)).`,
  );
}

function writeBaseline() {
  const { jobs, perWorkflow } = findFootprint();
  writeFileSync(BASELINE_PATH, `${JSON.stringify({ jobs, perWorkflow }, null, 2)}\n`);
  console.log(`ci-footprint baseline frozen: ${jobs} job(s) per pull request`);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  if (process.argv.includes('--write-baseline')) writeBaseline();
  else main();
}

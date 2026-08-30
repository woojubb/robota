import { spawnSync } from 'node:child_process';

import { repositoryName as boundedRepositoryName } from './work-run-git-adapter.mjs';
import { repositoryNameFromGit } from './work-run-git.mjs';
import {
  forcePushEdge,
  resolveAttestedOpeningHeadFromHistory,
} from './work-run-opening-head-history.mjs';
import { attestedOpeningHead } from './work-run-opening-head-evidence.mjs';
import { pullRequestTimeline } from './work-run-pr-timeline.mjs';
import { loadPullRequestCommitAncestry } from './work-run-pr-ancestry.mjs';
import { terminalPullRequestWorkRunId } from './work-run-pr-body.mjs';
import { validateRemoteOpeningClosure } from './work-run-remote-closure-evidence.mjs';
import { takeWorkRunVerificationQuery } from './work-run-verification-runtime.mjs';

const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const GITHUB_BUFFER_BYTES = 8 * 1024 * 1024;
const GITHUB_REQUEST_BUDGET = 1_016;
const GITHUB_QUERY_BUDGET_MS = 15_000;

function requestTimeout(budget) {
  if (typeof budget.now === 'function') return takeWorkRunVerificationQuery(budget);
  if (budget.remaining < 1) throw new Error('GitHub pull-request evidence budget exhausted');
  budget.remaining -= 1;
  const remainingMs = budget.deadline - Date.now();
  if (remainingMs < 1) throw new Error('GitHub pull-request evidence query timed out');
  return Math.min(10_000, remainingMs);
}

function runGitHubJson(args, run, root, budget) {
  const result = run('gh', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: requestTimeout(budget),
    maxBuffer: GITHUB_BUFFER_BYTES,
  });
  if (result.error || result.status !== 0) {
    throw new Error('GitHub pull-request head evidence query failed');
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error('GitHub pull-request head evidence response is invalid');
  }
}

function encodedPath(value) {
  return value.split('/').map(encodeURIComponent).join('/');
}

function verifyRemoteOpeningHead(root, repository, initial, run, budget) {
  const receiptPath = `.agents/evals/work-runs/${initial.runId}/g0-r0.json`;
  const commit = runGitHubJson(
    ['api', `/repos/${repository}/commits/${initial.headOid}`],
    run,
    root,
    budget,
  );
  const content = runGitHubJson(
    ['api', `/repos/${repository}/contents/${encodedPath(receiptPath)}?ref=${initial.headOid}`],
    run,
    root,
    budget,
  );
  return validateRemoteOpeningClosure({
    commit,
    content,
    headOid: initial.headOid,
    runId: initial.runId,
  });
}

export function resolvePullRequestHistoryContext(
  root,
  branch,
  { run = spawnSync, repository = null, runtime = null } = {},
) {
  const resolvedRepository =
    repository ?? (runtime ? boundedRepositoryName(root, runtime) : repositoryNameFromGit(root));
  const budget = runtime ?? {
    remaining: GITHUB_REQUEST_BUDGET,
    deadline: Date.now() + GITHUB_QUERY_BUDGET_MS,
  };
  const owner = resolvedRepository.split('/')[0];
  const pulls = runGitHubJson(
    [
      'api',
      '-X',
      'GET',
      '-f',
      'state=all',
      '-f',
      `head=${owner}:${branch}`,
      '-f',
      'per_page=2',
      `/repos/${resolvedRepository}/pulls`,
    ],
    run,
    root,
    budget,
  );
  if (!Array.isArray(pulls)) {
    return { status: 'unavailable', reason: 'github-pr-history-response-invalid' };
  }
  if (pulls.length === 0) return { status: 'none' };
  if (pulls.length !== 1) {
    return { status: 'unavailable', reason: 'github-pr-history-ambiguous' };
  }
  const number = Number(pulls[0]?.number);
  const state = pulls[0]?.state;
  if (!Number.isInteger(number) || number < 1 || !['open', 'closed'].includes(state)) {
    return { status: 'unavailable', reason: 'github-pr-history-response-invalid' };
  }
  return { status: state, number, createdAt: pulls[0]?.created_at ?? null };
}

function evidenceContext(root, run, runtime, repository) {
  return {
    repository:
      repository ?? (runtime ? boundedRepositoryName(root, runtime) : repositoryNameFromGit(root)),
    budget: runtime ?? {
      remaining: GITHUB_REQUEST_BUDGET,
      deadline: Date.now() + GITHUB_QUERY_BUDGET_MS,
    },
    root,
    run,
  };
}

function resolveOpeningHistory(context, pr, timeline) {
  const queryJson = (args) => runGitHubJson(args, context.run, context.root, context.budget);
  return resolveAttestedOpeningHeadFromHistory({
    timeline,
    loadCommits: (oid, maxCommits) =>
      loadPullRequestCommitAncestry({
        repository: context.repository,
        startOid: oid,
        expectedRunId: null,
        maxCommits,
        queryJson,
      }),
    isAttested: (candidate) =>
      attestedOpeningHead(context.root, context.repository, pr.created_at, candidate, context) !==
      null,
  });
}

function validatePullRequestHead(pr) {
  const currentHeadOid = pr?.head?.sha;
  const branch = pr?.head?.ref;
  if (!OID_PATTERN.test(currentHeadOid ?? '') || typeof branch !== 'string' || !branch) {
    throw new Error('GitHub pull-request current head evidence is invalid');
  }
  return currentHeadOid;
}

function fetchPullRequestEvidence(root, run, { number, runtime = null, repository = null }) {
  if (number === null) return { status: 'not-found' };
  if (!Number.isInteger(number) || number < 1) {
    throw new Error('GitHub pull-request evidence needs a valid PR number');
  }
  const context = evidenceContext(root, run, runtime, repository);
  const queryJson = (args) => runGitHubJson(args, run, root, context.budget);
  const pr = queryJson(['api', `/repos/${context.repository}/pulls/${number}`]);
  const bodyRunId = terminalPullRequestWorkRunId(pr?.body);
  const currentHeadOid = validatePullRequestHead(pr);
  const timeline = pullRequestTimeline(context.repository, number, queryJson);
  const initial = resolveOpeningHistory(context, pr, timeline);
  if (bodyRunId !== initial.runId) {
    throw new Error('GitHub PR body Work-Run marker does not match opening evidence');
  }
  const remoteClosure = verifyRemoteOpeningHead(
    root,
    context.repository,
    initial,
    run,
    context.budget,
  );
  return {
    status: 'found',
    number,
    firstHeadOid: initial.headOid,
    currentHeadOid,
    runId: initial.runId,
    forcePushEdges: timeline
      .filter((event) => event?.event === 'head_ref_force_pushed')
      .map(forcePushEdge),
    openingReceiptDigest: remoteClosure.receiptDigest,
  };
}

export function createPullRequestEvidenceFetcher(root, { run = spawnSync } = {}) {
  return (options) => fetchPullRequestEvidence(root, run, options);
}

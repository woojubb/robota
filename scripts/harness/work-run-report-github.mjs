import {
  adapterFailure,
  completeCommitList,
  completeSearchItems,
  consumeBudget,
  createGitHubLookupBudget,
  GITHUB_DEFAULTS,
  positiveInteger,
  runGitHubJson,
} from './work-run-report-github-client.mjs';
import { terminalPullRequestWorkRunId } from './work-run-pr-body.mjs';
import {
  queryReportOpeningHeadEvidence,
  queryReportPullRequestTimeline,
} from './work-run-report-github-evidence.mjs';

function pullRequestBodyRunId(body) {
  try {
    return terminalPullRequestWorkRunId(body);
  } catch {
    return null;
  }
}

export function joinPullRequest(receipt, queryResult) {
  if (queryResult?.ok !== true || !Array.isArray(queryResult.pullRequests)) {
    return { ok: false, reason: queryResult?.reason ?? 'pr-query-failed' };
  }
  if (queryResult.pullRequests.length === 0) return { ok: false, reason: 'no-pr-match' };
  if (queryResult.pullRequests.length > 1) {
    return { ok: false, reason: 'multiple-pr-matches' };
  }
  const pr = queryResult.pullRequests[0];
  if (pr?.openingHeadEvidence?.ok !== true) {
    return {
      ok: false,
      reason: pr?.openingHeadEvidence?.reason ?? 'opening-head-evidence-unavailable',
    };
  }
  const joinHeadCommit = receipt.prJoinHeadCommit ?? receipt.identity?.headCommit;
  return pullRequestMatches(receipt, queryResult, pr, joinHeadCommit)
    ? { ok: true, prNumber: pr.number, createdAt: pr.createdAt }
    : { ok: false, reason: 'pr-identity-mismatch' };
}

function pullRequestMatches(receipt, queryResult, pr, joinHeadCommit) {
  const range = pr?.headRange;
  return (
    queryResult.repository === receipt.identity?.repository &&
    pr?.repository === queryResult.repository &&
    pr?.number === queryResult.prNumber &&
    pullRequestBodyRunId(pr?.body) === receipt.runId &&
    range?.startOid === joinHeadCommit &&
    range?.endOid === pr?.headOid &&
    range?.startIsAncestor === true &&
    Array.isArray(range?.commitRunIds) &&
    range.commitRunIds.includes(receipt.runId)
  );
}

function workRunIdsFromCommits(commits) {
  const ids = new Set();
  for (const commit of commits) {
    for (const line of String(commit?.commit?.message ?? '').split(/\r?\n/u)) {
      const match = /^Work-Run:\s*(\S+)\s*$/u.exec(line);
      if (match) ids.add(match[1]);
    }
  }
  return [...ids];
}

function githubSearchQueries(repository, group, maxQueryBytes) {
  const prefix = `repo:${repository} is:pr (`;
  const suffix = ')';
  const queries = [];
  let terms = [];
  for (const entry of group) {
    const term = `"Work-Run: ${entry.receipt.runId}"`;
    const candidateTerms = [...terms, term];
    const candidate = `${prefix}${candidateTerms.join(' OR ')}${suffix}`;
    if (Buffer.byteLength(candidate, 'utf8') <= maxQueryBytes) {
      terms = candidateTerms;
      continue;
    }
    if (terms.length === 0) {
      throw adapterFailure('search-query-too-long', 'One work-run search term exceeds the limit');
    }
    queries.push(`${prefix}${terms.join(' OR ')}${suffix}`);
    terms = [term];
    if (Buffer.byteLength(`${prefix}${term}${suffix}`, 'utf8') > maxQueryBytes) {
      throw adapterFailure('search-query-too-long', 'One work-run search term exceeds the limit');
    }
  }
  if (terms.length > 0) queries.push(`${prefix}${terms.join(' OR ')}${suffix}`);
  return queries;
}

function groupReceipts(receipts, results) {
  const byRepository = new Map();
  for (const [index, receipt] of receipts.entries()) {
    const repository = receipt.identity?.repository;
    const joinHeadCommit = receipt.prJoinHeadCommit ?? receipt.identity?.headCommit;
    if (!repository || !receipt.runId || !joinHeadCommit) {
      results[index] = { ok: false, reason: 'invalid-receipt-identity' };
      continue;
    }
    const group = byRepository.get(repository) ?? [];
    group.push({ index, receipt, joinHeadCommit });
    byRepository.set(repository, group);
  }
  return byRepository;
}

function searchCandidates(repository, group, context) {
  const candidates = new Map();
  const queryLimit = Math.min(
    positiveInteger(context.maxSearchQueryBytes, 'maxSearchQueryBytes'),
    GITHUB_DEFAULTS.maxSearchQueryBytes,
  );
  for (const query of githubSearchQueries(repository, group, queryLimit)) {
    const pages = runGitHubJson(
      [
        'api',
        '--method',
        'GET',
        '--paginate',
        '--slurp',
        '/search/issues',
        '-f',
        `q=${query}`,
        '-f',
        'per_page=100',
      ],
      context,
    );
    consumeBudget(context.budget, 'remainingPages', pages.length, 'page-budget-exhausted');
    for (const candidate of completeSearchItems(pages, context.maxPages)) {
      if (!Number.isInteger(candidate?.number)) {
        throw adapterFailure('invalid-response', 'GitHub search result has no PR number');
      }
      candidates.set(candidate.number, candidate);
    }
  }
  if (candidates.size > context.maxCandidates) {
    throw adapterFailure('candidate-limit', 'GitHub search candidate limit exceeded');
  }
  consumeBudget(
    context.budget,
    'remainingCandidates',
    candidates.size,
    'candidate-budget-exhausted',
  );
  return [...candidates.values()];
}

function projectedPullRequest(repository, pr, receipt, joinHeadCommit, commits, context) {
  const endIndex = commits.findIndex((commit) => commit?.sha === pr?.head?.sha);
  const startIndex = commits.findIndex((commit) => commit?.sha === joinHeadCommit);
  const range =
    startIndex >= 0 && endIndex >= startIndex ? commits.slice(startIndex, endIndex + 1) : [];
  const openingHeadEvidence = context.queryOpeningHeadEvidence(
    repository,
    pr,
    receipt,
    range,
    context,
  );
  return {
    repository: pr?.base?.repo?.full_name,
    number: pr?.number,
    body: pr?.body,
    headOid: pr?.head?.sha,
    createdAt: pr?.created_at,
    openingHeadEvidence,
    headRange: {
      startOid: joinHeadCommit,
      endOid: pr?.head?.sha,
      startIsAncestor: range.length > 0,
      commitRunIds: workRunIdsFromCommits(range),
    },
  };
}

function appendCandidate(repository, candidate, group, byIndex, context) {
  const pr = runGitHubJson(['api', `/repos/${repository}/pulls/${candidate.number}`], context);
  const bodyRunId = pullRequestBodyRunId(pr?.body);
  const matching = group.filter(({ receipt }) => receipt.runId === bodyRunId);
  if (matching.length === 0) return;
  const pages = runGitHubJson(
    [
      'api',
      '--paginate',
      '--slurp',
      `/repos/${repository}/pulls/${pr.number}/commits?per_page=100`,
    ],
    context,
  );
  consumeBudget(context.budget, 'remainingPages', pages.length, 'page-budget-exhausted');
  const commits = completeCommitList(pages, context.maxPages);
  const projectionContext = context.defaultOpeningEvidence
    ? { ...context, timeline: queryReportPullRequestTimeline(repository, pr.number, context) }
    : context;
  for (const { index, receipt, joinHeadCommit } of matching) {
    byIndex
      .get(index)
      .push(
        projectedPullRequest(repository, pr, receipt, joinHeadCommit, commits, projectionContext),
      );
  }
}

function queryRepository(repository, group, context) {
  const byIndex = new Map(group.map(({ index }) => [index, []]));
  for (const candidate of searchCandidates(repository, group, context)) {
    appendCandidate(repository, candidate, group, byIndex, context);
  }
  return group.map(({ index }) => {
    const pullRequests = byIndex.get(index);
    return {
      index,
      result: {
        ok: true,
        repository,
        prNumber: pullRequests.length === 1 ? pullRequests[0].number : null,
        pullRequests,
      },
    };
  });
}

function githubQueryContext(receipts, options) {
  const timeoutMs = options.timeoutMs ?? GITHUB_DEFAULTS.timeoutMs;
  const maxPages = options.maxPages ?? GITHUB_DEFAULTS.maxPages;
  const maxCandidates = options.maxCandidates ?? GITHUB_DEFAULTS.maxCandidates;
  const openingEvidence = options.queryOpeningHeadEvidence ?? queryReportOpeningHeadEvidence;
  return {
    runGh: options.runGh,
    timeoutMs,
    maxBytes: options.maxBytes ?? GITHUB_DEFAULTS.maxBytes,
    maxPages,
    maxCandidates,
    maxSearchQueryBytes: options.maxSearchQueryBytes ?? GITHUB_DEFAULTS.maxSearchQueryBytes,
    queryOpeningHeadEvidence: openingEvidence,
    defaultOpeningEvidence: openingEvidence === queryReportOpeningHeadEvidence,
    budget:
      options.budget ??
      createGitHubLookupBudget({
        totalTimeoutMs: timeoutMs,
        maxReceipts: Math.max(1, receipts.length),
        maxPages,
        maxCandidates,
      }),
  };
}

function assignRepositoryFailure(results, group, error) {
  for (const { index } of group) {
    results[index] = {
      ok: false,
      reason: error.adapterReason ?? 'query-failed',
      detail: error.message,
    };
  }
}

export function queryGitHubPullRequests(receipts, options = {}) {
  if (!Array.isArray(receipts)) throw new TypeError('receipts must be an array');
  const context = githubQueryContext(receipts, options);
  const results = receipts.map(() => null);
  for (const [repository, group] of groupReceipts(receipts, results)) {
    try {
      for (const entry of queryRepository(repository, group, context))
        results[entry.index] = entry.result;
    } catch (error) {
      assignRepositoryFailure(results, group, error);
    }
  }
  return results;
}

export function queryGitHubPullRequest(receipt, options = {}) {
  return queryGitHubPullRequests([receipt], options)[0];
}

export { createGitHubLookupBudget } from './work-run-report-github-client.mjs';

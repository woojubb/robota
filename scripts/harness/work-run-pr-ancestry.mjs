import {
  exactWorkRunReceiptTrailers,
  workRunReceiptTrailers,
} from './work-run-commit-trailers.mjs';
import { generationZeroReceiptRevision } from './work-run-validation-foundation.mjs';

const PAGE_SIZE = 100;

function queryArgs(repository, startOid, page) {
  return [
    'api',
    '-X',
    'GET',
    '-f',
    `sha=${startOid}`,
    '-f',
    `per_page=${PAGE_SIZE}`,
    '-f',
    `page=${page}`,
    `/repos/${repository}/commits`,
  ];
}

function containsOpeningReceipt(commits, expectedRunId) {
  return commits.some((commit) => {
    const message = commit?.commit?.message ?? '';
    if (
      !workRunReceiptTrailers(message).receiptIds.some(
        (receiptId) => generationZeroReceiptRevision(receiptId) !== null,
      )
    )
      return false;
    const trailers = exactWorkRunReceiptTrailers(message);
    return (
      generationZeroReceiptRevision(trailers.receiptId) !== null &&
      (expectedRunId === null || trailers.runId === expectedRunId)
    );
  });
}

function validatePage(commits, seen) {
  if (!Array.isArray(commits) || commits.length > PAGE_SIZE) {
    throw new Error('GitHub commit ancestry response is invalid');
  }
  for (const commit of commits) {
    if (typeof commit?.sha !== 'string' || seen.has(commit.sha)) {
      throw new Error('GitHub commit ancestry response is invalid');
    }
    seen.add(commit.sha);
  }
}

export function loadPullRequestCommitAncestry({
  repository,
  startOid,
  expectedRunId,
  maxCommits,
  queryJson,
}) {
  const commits = [];
  const seen = new Set();
  const maxPages = Math.ceil(maxCommits / PAGE_SIZE);
  for (let page = 1; page <= maxPages; page += 1) {
    const pageCommits = queryJson(queryArgs(repository, startOid, page));
    validatePage(pageCommits, seen);
    if (page === 1 && pageCommits[0]?.sha !== startOid) {
      throw new Error('GitHub commit ancestry does not start at the requested commit');
    }
    commits.push(...pageCommits.slice(0, maxCommits - commits.length));
    if (
      pageCommits.length < PAGE_SIZE ||
      containsOpeningReceipt(pageCommits, expectedRunId) ||
      commits.length === maxCommits
    ) {
      return commits;
    }
  }
  return commits;
}

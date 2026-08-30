import {
  exactWorkRunReceiptTrailers,
  workRunReceiptTrailers,
} from './work-run-commit-trailers.mjs';
import {
  generationZeroReceiptRevision,
  MAX_RANGE_COMMITS,
} from './work-run-validation-foundation.mjs';

const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function evidenceFailure(reason, message) {
  const error = new Error(message);
  error.evidenceReason = reason;
  return error;
}

export function forcePushEdge(event) {
  const before = event?.before;
  const after = event?.after;
  if (!OID_PATTERN.test(before ?? '') || !OID_PATTERN.test(after ?? '') || before === after) {
    throw evidenceFailure(
      'force-push-evidence-invalid',
      'GitHub force-push timeline evidence is invalid',
    );
  }
  return { before, after };
}

function historicalCommit(value) {
  const sha = value?.sha;
  const message = value?.message ?? value?.commit?.message;
  const parents = value?.parents;
  if (
    !OID_PATTERN.test(sha ?? '') ||
    typeof message !== 'string' ||
    !Array.isArray(parents) ||
    parents.some((parent) => !OID_PATTERN.test(parent?.sha ?? ''))
  ) {
    throw evidenceFailure('commit-evidence-invalid', 'GitHub commit evidence is invalid');
  }
  return { sha, message, parents: parents.map(({ sha: parent }) => parent) };
}

function timelineCommits(timeline) {
  const commits = new Map();
  for (const event of timeline) {
    if (event?.event !== 'committed') continue;
    const commit = historicalCommit(event);
    if (commits.has(commit.sha)) {
      throw evidenceFailure(
        'commit-evidence-ambiguous',
        'GitHub committed timeline evidence is duplicate or ambiguous',
      );
    }
    commits.set(commit.sha, commit);
  }
  return commits;
}

function initialReceiptHeads(commits, expectedRunId) {
  const matches = [];
  for (const commit of commits.values()) {
    const trailers = workRunReceiptTrailers(commit.message);
    if (!trailers.receiptIds.some((receiptId) => generationZeroReceiptRevision(receiptId) !== null))
      continue;
    const exact = exactWorkRunReceiptTrailers(commit.message);
    if (generationZeroReceiptRevision(exact.receiptId) === null) continue;
    if (expectedRunId !== null && exact.runId !== expectedRunId) continue;
    matches.push({ headOid: commit.sha, runId: exact.runId });
  }
  return matches;
}

function hasGenerationZeroTrailer(commit) {
  return workRunReceiptTrailers(commit.message).receiptIds.some(
    (receiptId) => generationZeroReceiptRevision(receiptId) !== null,
  );
}

function hydrateMissingCommit(oid, commits, loadCommit, loadCommits, remaining) {
  if (commits.has(oid)) return commits.get(oid);
  const loaded = loadCommits ? loadCommits(oid, remaining) : [loadCommit(oid)];
  if (!Array.isArray(loaded) || loaded.length === 0) {
    throw evidenceFailure('commit-evidence-invalid', 'GitHub commit evidence is invalid');
  }
  for (const value of loaded) {
    const commit = historicalCommit(value);
    commits.set(commit.sha, commit);
  }
  const commit = commits.get(oid);
  if (!commit)
    throw evidenceFailure('commit-evidence-invalid', 'GitHub commit evidence is invalid');
  return commit;
}

function hydrateForcePushAncestors(timeline, commits, loadCommit, loadCommits) {
  const pending = timeline
    .filter((event) => event?.event === 'head_ref_force_pushed')
    .map((event) => forcePushEdge(event).before);
  const visited = new Set();
  while (pending.length > 0 && visited.size < MAX_RANGE_COMMITS) {
    const oid = pending.pop();
    if (visited.has(oid)) continue;
    visited.add(oid);
    const commit = hydrateMissingCommit(
      oid,
      commits,
      loadCommit,
      loadCommits,
      MAX_RANGE_COMMITS - visited.size + 1,
    );
    if (!hasGenerationZeroTrailer(commit)) {
      pending.push(...commit.parents.filter((parent) => !visited.has(parent)));
    }
  }
  if (pending.length > 0) {
    throw evidenceFailure(
      'force-push-ancestry-budget-exhausted',
      'GitHub historical force-push ancestry exceeds the evidence budget',
    );
  }
}

function attestedCandidates(commits, expectedRunId, isAttested) {
  return initialReceiptHeads(commits, expectedRunId).filter(isAttested);
}

export function resolveAttestedOpeningHeadFromHistory({
  timeline,
  expectedRunId = null,
  loadCommit = null,
  loadCommits = null,
  isAttested,
}) {
  if (
    !Array.isArray(timeline) ||
    (typeof loadCommit !== 'function' && typeof loadCommits !== 'function') ||
    typeof isAttested !== 'function'
  ) {
    throw evidenceFailure(
      'opening-head-history-invalid',
      'Opening-head history inputs are invalid',
    );
  }
  const commits = timelineCommits(timeline);
  let attested = attestedCandidates(commits, expectedRunId, isAttested);
  if (attested.length === 0) {
    hydrateForcePushAncestors(timeline, commits, loadCommit, loadCommits);
    attested = attestedCandidates(commits, expectedRunId, isAttested);
  }
  if (attested.length !== 1) {
    throw evidenceFailure(
      'opening-head-comment-missing-or-ambiguous',
      'GitHub pre-PR opening-head comment is missing or ambiguous',
    );
  }
  return attested[0];
}

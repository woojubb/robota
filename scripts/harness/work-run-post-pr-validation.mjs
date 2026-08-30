import { createHash } from 'node:crypto';

import {
  authorizationBoundaryHead,
  exactReceiptClosure,
  tryGit,
  tryGitBytes,
} from './work-run-git-adapter.mjs';
import { historicalRebaseSuffixMatches } from './work-run-historical-rebase-suffix.mjs';
import {
  ensureRebaseCommitAvailable,
  rebaseProofMatches,
  standaloneRebaseProofMatches,
} from './work-run-rebase-validation.mjs';
import { authorizationsMatch, OID_PATTERN } from './work-run-validation-foundation.mjs';
import { isWorkRunVerificationBudgetError } from './work-run-verification-runtime.mjs';

function pullRequestEvidenceVerdict({
  currentPrNumber,
  fetchPullRequestEvidence,
  repository,
  runtime,
}) {
  if (typeof fetchPullRequestEvidence !== 'function') {
    return currentPrNumber === null
      ? { ok: true, evidence: { status: 'not-found' } }
      : { ok: false, reason: 'pr-head-evidence-unverified' };
  }
  let evidence;
  try {
    evidence = fetchPullRequestEvidence({ number: currentPrNumber, repository, runtime });
  } catch (error) {
    if (isWorkRunVerificationBudgetError(error)) throw error;
    return { ok: false, reason: 'pr-context-unverified', detail: error.message };
  }
  if (evidence?.status === 'not-found') {
    return currentPrNumber === null
      ? { ok: true, evidence }
      : { ok: false, reason: 'pr-context-mismatch' };
  }
  const valid =
    evidence?.status === 'found' &&
    Number.isInteger(evidence.number) &&
    evidence.number > 0 &&
    typeof evidence.runId === 'string' &&
    evidence.runId.length > 0 &&
    Array.isArray(evidence.forcePushEdges) &&
    evidence.forcePushEdges.length <= 100 &&
    evidence.forcePushEdges.every(
      (edge) =>
        OID_PATTERN.test(edge?.before ?? '') &&
        OID_PATTERN.test(edge?.after ?? '') &&
        edge.before !== edge.after,
    ) &&
    /^[0-9a-f]{64}$/u.test(evidence.openingReceiptDigest ?? '') &&
    OID_PATTERN.test(evidence.firstHeadOid ?? '') &&
    OID_PATTERN.test(evidence.currentHeadOid ?? '');
  if (!valid) return { ok: false, reason: 'pr-head-evidence-unverified' };
  if (currentPrNumber !== null && evidence.number !== currentPrNumber) {
    return { ok: false, reason: 'pr-context-mismatch' };
  }
  return { ok: true, evidence };
}

function generationZeroClosure({
  root,
  baseCommit,
  subjectCommit,
  receiptPaths,
  receipt,
  runtime,
}) {
  const openingReady = receipt.events?.findLast(
    (event) => event.type === 'work.ready' && event.data?.generation === 0,
  );
  const openingRevision =
    receipt.generation === 0 ? receipt.revision : openingReady?.data?.revision;
  if (!Number.isInteger(openingRevision) || openingRevision < 0) return null;
  const receiptPath = `.agents/evals/work-runs/${receipt.runId}/g0-r${openingRevision}.json`;
  if (!receiptPaths.includes(receiptPath)) return null;
  const oid =
    receipt.generation === 0
      ? subjectCommit
      : tryGit(
          root,
          [
            'log',
            '-1',
            '--format=%H',
            '--diff-filter=A',
            `${baseCommit}..${subjectCommit}`,
            '--',
            receiptPath,
          ],
          runtime,
        );
  if (!oid || exactReceiptClosure(root, oid, runtime)?.receiptPath !== receiptPath) return null;
  const bytes = tryGitBytes(root, ['show', `${oid}:${receiptPath}`], runtime);
  return bytes === null ? null : { oid, digest: createHash('sha256').update(bytes).digest('hex') };
}

export function validatePostPrGeneration(context, receipt = context.receipt) {
  const { currentPrNumber, actual, baseCommit, messages, root, runtime } = context;
  if (receipt.generation === 0) return { ok: true };
  if (!Number.isInteger(currentPrNumber) || currentPrNumber < 1) {
    return { ok: false, reason: 'current-pr-required' };
  }
  if (receipt.authorization.prNumber !== currentPrNumber) {
    return { ok: false, reason: 'authorization-pr-mismatch' };
  }
  const reopen = receipt.events.find(
    (event) =>
      event.type === 'work.reopened' &&
      event.data?.generation === receipt.generation &&
      event.data?.revision === receipt.revision,
  );
  let liveAuthorization;
  try {
    liveAuthorization = context.liveAuthorizations?.get(receipt.authorization.commentId);
    if (!liveAuthorization && typeof context.fetchAuthorization === 'function') {
      liveAuthorization = context.fetchAuthorization({
        repository: context.repository,
        commentId: receipt.authorization.commentId,
        authorizedAt: reopen?.at ?? null,
        runtime,
      });
    }
  } catch (error) {
    if (isWorkRunVerificationBudgetError(error)) throw error;
    return { ok: false, reason: 'authorization-comment-unverified' };
  }
  if (!reopen || !authorizationsMatch(liveAuthorization, receipt.authorization)) {
    return { ok: false, reason: 'authorization-comment-mismatch' };
  }
  const boundary = authorizationBoundaryHead(
    actual.commitOids,
    receipt.generation,
    baseCommit,
    messages,
  );
  const matches =
    receipt.authorization.action === 'rebase'
      ? boundary !== null && rebaseProofMatches(root, receipt, boundary, baseCommit, runtime)
      : receipt.authorization.head === boundary;
  return matches ? { ok: true } : { ok: false, reason: 'authorization-head-mismatch' };
}

function rebaseProofs(receipt) {
  return (Array.isArray(receipt.events) ? receipt.events : [])
    .filter(
      (event) =>
        event.type === 'work.reopened' &&
        event.data?.revision === 0 &&
        event.data?.rebaseProof !== undefined,
    )
    .map((event) => ({ generation: event.data.generation, proof: event.data.rebaseProof }));
}

function safeRebaseSuffix(context, edge, candidate) {
  const { proof, generation } = candidate;
  if (edge.after === proof.newHead) return true;
  if (!ensureRebaseCommitAvailable(context.root, edge.after, context.runtime)) return false;
  return historicalRebaseSuffixMatches({
    root: context.root,
    subjectCommit: context.subjectCommit,
    currentReceipt: context.receipt,
    edgeAfter: edge.after,
    proof,
    generation,
    runtime: context.runtime,
  });
}

function edgeMatchesProof(context, edge, candidate) {
  const { proof } = candidate;
  if (edge.before !== proof.oldHead) return false;
  return safeRebaseSuffix(context, edge, candidate);
}

function forcePushHistoryVerdict(context, evidence) {
  const proofs = rebaseProofs(context.receipt);
  if (
    proofs.some(({ proof }) => !standaloneRebaseProofMatches(context.root, proof, context.runtime))
  ) {
    return false;
  }
  const unused = new Set(proofs.map((_, index) => index));
  for (const edge of evidence.forcePushEdges) {
    const matches = [...unused].filter((index) => edgeMatchesProof(context, edge, proofs[index]));
    if (matches.length !== 1) return false;
    unused.delete(matches[0]);
  }
  if (context.prObservation === 'post-push') return unused.size === 0;
  if (unused.size === 0) return true;
  if (unused.size !== 1 || context.receipt.authorization?.action !== 'rebase') return false;
  const prospective = proofs[[...unused][0]];
  return (
    prospective.generation === context.receipt.generation &&
    prospective.proof.oldHead === evidence.currentHeadOid &&
    safeRebaseSuffix(context, { after: context.subjectCommit }, prospective) &&
    validatePostPrGeneration(context).ok
  );
}

function observedHeadMatches(context, evidence) {
  if (context.prObservation === 'post-push' || context.receipt.generation === 0) {
    return evidence.currentHeadOid === context.subjectCommit;
  }
  return evidence.currentHeadOid === context.receipt.authorization?.head;
}

export function validateGenerationZero(context) {
  const { receipt, subjectCommit, currentPrNumber, fetchPullRequestEvidence, repository, runtime } =
    context;
  if (!['pre-push', 'post-push'].includes(context.prObservation)) {
    return { ok: false, reason: 'invalid-pr-observation' };
  }
  const verdict = pullRequestEvidenceVerdict({
    currentPrNumber,
    fetchPullRequestEvidence,
    repository,
    runtime,
  });
  if (!verdict.ok) return verdict;
  if (verdict.evidence.status !== 'found') return { ok: true };
  const closure = generationZeroClosure(context);
  const forcePushesAuthorized = forcePushHistoryVerdict(context, verdict.evidence);
  const matches =
    closure !== null &&
    verdict.evidence.runId === receipt.runId &&
    verdict.evidence.openingReceiptDigest === closure.digest &&
    observedHeadMatches(context, verdict.evidence) &&
    forcePushesAuthorized &&
    (verdict.evidence.firstHeadOid === closure.oid ||
      verdict.evidence.forcePushEdges.length > 0 ||
      (context.prObservation === 'pre-push' && receipt.authorization?.action === 'rebase'));
  return matches ? { ok: true } : { ok: false, reason: 'post-pr-local-fix' };
}

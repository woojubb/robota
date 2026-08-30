import { createHash } from 'node:crypto';

import { exactWorkRunReceiptTrailers } from './work-run-commit-trailers.mjs';
import {
  commitMessageMap,
  exactReceiptClosure,
  identityAtReadyHead,
  tryGit,
  tryGitBytes,
} from './work-run-git-adapter.mjs';
import { validateWorkRunReceipt } from './work-run-receipt-validation.mjs';
import { identitiesMatch, same } from './work-run-validation-foundation.mjs';

function exactReceiptTrailers(message, runId, receiptName) {
  try {
    const trailers = exactWorkRunReceiptTrailers(message);
    return trailers.runId === runId && trailers.receiptId === receiptName;
  } catch {
    return false;
  }
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function exactBindAndClosure(root, closure, proof, runId, receiptName, runtime) {
  const bindAncestry = tryGit(
    root,
    ['rev-list', '--parents', '-n', '1', closure.readyHead],
    runtime,
  )
    ?.split(' ')
    .filter(Boolean);
  if (bindAncestry?.length !== 2 || bindAncestry[1] !== proof.newHead) return false;
  const messages = commitMessageMap(root, [closure.readyHead, closure.closureCommit], runtime);
  return (
    messages !== null &&
    exactReceiptTrailers(messages.get(closure.readyHead) ?? '', runId, receiptName) &&
    exactReceiptTrailers(messages.get(closure.closureCommit) ?? '', runId, receiptName)
  );
}

function exactHistoricalReceipt({ root, subjectCommit, closure, receiptPath, runtime }) {
  const historicalBytes = tryGitBytes(
    root,
    ['show', `${closure.closureCommit}:${receiptPath}`],
    runtime,
  );
  const retainedBytes = tryGitBytes(root, ['show', `${subjectCommit}:${receiptPath}`], runtime);
  if (
    historicalBytes === null ||
    retainedBytes === null ||
    digest(historicalBytes) !== digest(retainedBytes)
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(historicalBytes.toString('utf8'));
    const verdict = validateWorkRunReceipt(parsed, { receiptPath });
    return verdict.ok && verdict.receipt.disposition === 'included' ? verdict.receipt : null;
  } catch {
    return null;
  }
}

export function historicalRebaseSuffixMatches({
  root,
  subjectCommit,
  currentReceipt,
  edgeAfter,
  proof,
  generation,
  runtime,
}) {
  const receiptName = `g${generation}-r0`;
  const receiptPath = `.agents/evals/work-runs/${currentReceipt.runId}/${receiptName}.json`;
  const closure = exactReceiptClosure(root, edgeAfter, runtime);
  if (
    closure?.receiptPath !== receiptPath ||
    !exactBindAndClosure(root, closure, proof, currentReceipt.runId, receiptName, runtime)
  ) {
    return false;
  }
  const unchangedTree =
    tryGit(root, ['rev-parse', `${closure.readyHead}^{tree}`], runtime) ===
    tryGit(root, ['rev-parse', `${proof.newHead}^{tree}`], runtime);
  const receipt = exactHistoricalReceipt({ root, subjectCommit, closure, receiptPath, runtime });
  if (!unchangedTree || receipt === null) return false;
  const expectedIdentity = identityAtReadyHead({
    root,
    repository: currentReceipt.identity.repository,
    branch: currentReceipt.identity.branch,
    baseCommit: proof.newBase,
    readyHead: closure.readyHead,
    runtime,
  });
  const receiptProof = receipt.events.find(
    (event) =>
      event.type === 'work.reopened' &&
      event.data?.generation === generation &&
      event.data?.revision === 0,
  )?.data?.rebaseProof;
  return (
    receipt.runId === currentReceipt.runId &&
    receipt.generation === generation &&
    receipt.revision === 0 &&
    receipt.authorization?.action === 'rebase' &&
    receipt.authorization.head === proof.oldHead &&
    identitiesMatch(receipt.identity, expectedIdentity) &&
    same(receiptProof, proof)
  );
}

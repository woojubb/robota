import { validateWorkRunReceipt } from './work-run-receipt-validation.mjs';
import { identitiesMatch } from './work-run-validation-foundation.mjs';

export { validateRepositoryWorkRun } from './work-run-repository-validation.mjs';
export { validateWorkRunReceipt } from './work-run-receipt-validation.mjs';
export { rebaseProofMatches } from './work-run-rebase-validation.mjs';
export {
  identitiesMatch,
  validatePostPrAuthorizationProjection,
} from './work-run-validation-foundation.mjs';

export const CUTOVER_SCHEMA_VERSION = 1;

export function validateWorkRunMeasurement({
  operation,
  protectedBranch,
  changedPaths,
  identity,
  receipts,
}) {
  if (operation === 'delete' || operation === 'no-content' || protectedBranch) {
    return { ok: true, population: 'outside-topic-range' };
  }
  if (!Array.isArray(changedPaths)) return { ok: false, reason: 'classifier-failure' };
  if (!Array.isArray(receipts) || receipts.length === 0) {
    return { ok: false, reason: 'missing-measurement' };
  }
  const runIds = new Set(receipts.map((receipt) => receipt?.runId));
  if (receipts.length !== 1 || runIds.size !== 1) {
    return { ok: false, reason: 'mixed-measurement' };
  }
  const verdict = validateWorkRunReceipt(receipts[0]);
  if (!verdict.ok) return verdict;
  const receipt = verdict.receipt;
  if (!identitiesMatch(receipt.identity, identity))
    return { ok: false, reason: 'identity-mismatch' };
  if (receipt.disposition === 'included') {
    return { ok: true, population: 'included', runId: receipt.runId };
  }
  if (['excluded', 'pre-cutover'].includes(receipt.disposition)) {
    return { ok: true, population: 'excluded', runId: receipt.runId };
  }
  if (receipt.disposition === 'invalid') {
    return { ok: true, population: 'invalid', runId: receipt.runId };
  }
  return { ok: false, reason: 'unsupported-disposition' };
}

export function validateCutoverDisposition({ marker, mode, prNumber, receipt }) {
  if (
    !marker ||
    marker.schemaVersion !== CUTOVER_SCHEMA_VERSION ||
    !Array.isArray(marker.openPullRequests)
  ) {
    return { ok: false, reason: 'invalid-cutover-marker' };
  }
  if (mode === 'introduction') return { ok: true, population: 'excluded' };
  if (mode === 'registered') {
    const entry = marker.openPullRequests.find((candidate) => candidate.number === prNumber);
    return entry
      ? { ok: true, population: 'excluded', entry }
      : { ok: false, reason: 'unregistered-pre-cutover-pr' };
  }
  if (mode === 'post-cutover') {
    return receipt?.disposition === 'pre-cutover'
      ? { ok: false, reason: 'post-cutover-pre-cutover-claim' }
      : { ok: true, population: 'included' };
  }
  return { ok: false, reason: 'unknown-cutover-mode' };
}

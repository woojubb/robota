const CUTOVER_VERSION = 1;
const CUTOVER_MARKER_ID = 'work-run-v1';
const MARKER_KEYS = ['generatedAt', 'markerId', 'openPullRequests', 'repository', 'schemaVersion'];
const ENTRY_KEYS = ['baseOid', 'createdAt', 'headOid', 'identity', 'number'];
const RECEIPT_KEYS = [
  'disposition',
  'generation',
  'identity',
  'markerId',
  'prNumber',
  'reason',
  'revision',
  'runId',
  'schemaVersion',
  'timestamps',
];
const IDENTITY_KEYS = [
  'baseCommit',
  'branch',
  'changeDigest',
  'commitOids',
  'headCommit',
  'headTree',
  'ownerFingerprint',
  'repository',
  'trailerDigest',
];
const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys)
  );
}

function isTimestamp(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function validMarkerEntry(entry, marker, previous) {
  return (
    exactKeys(entry, ENTRY_KEYS) &&
    Number.isInteger(entry.number) &&
    entry.number > previous &&
    isTimestamp(entry.createdAt) &&
    OID_PATTERN.test(entry.baseOid) &&
    OID_PATTERN.test(entry.headOid) &&
    exactKeys(entry.identity, IDENTITY_KEYS) &&
    entry.identity.repository === marker.repository &&
    entry.identity.baseCommit === entry.baseOid &&
    entry.identity.headCommit === entry.headOid &&
    OID_PATTERN.test(entry.identity.headTree) &&
    DIGEST_PATTERN.test(entry.identity.changeDigest) &&
    Array.isArray(entry.identity.commitOids) &&
    entry.identity.commitOids.length > 0 &&
    entry.identity.commitOids.at(-1) === entry.headOid &&
    entry.identity.commitOids.every((oid) => OID_PATTERN.test(oid)) &&
    DIGEST_PATTERN.test(entry.identity.trailerDigest) &&
    DIGEST_PATTERN.test(entry.identity.ownerFingerprint)
  );
}

export function validateCutoverMarker(marker, { repository } = {}) {
  const headerValid =
    exactKeys(marker, MARKER_KEYS) &&
    marker.schemaVersion === CUTOVER_VERSION &&
    marker.markerId === CUTOVER_MARKER_ID &&
    isTimestamp(marker.generatedAt) &&
    typeof marker.repository === 'string' &&
    marker.repository.length > 0 &&
    (!repository || marker.repository === repository) &&
    Array.isArray(marker.openPullRequests);
  if (!headerValid) return { ok: false, reason: 'invalid-cutover-marker' };
  let previous = 0;
  for (const entry of marker.openPullRequests) {
    if (!validMarkerEntry(entry, marker, previous)) {
      return { ok: false, reason: 'invalid-cutover-marker' };
    }
    previous = entry.number;
  }
  return { ok: true, marker };
}

function validReceiptIdentity(identity, marker, entry, subjectBranch) {
  return (
    exactKeys(identity, IDENTITY_KEYS) &&
    identity.repository === marker.repository &&
    identity.branch === subjectBranch &&
    identity.baseCommit === entry.baseOid &&
    identity.headCommit === entry.headOid &&
    OID_PATTERN.test(identity.headTree) &&
    DIGEST_PATTERN.test(identity.changeDigest) &&
    Array.isArray(identity.commitOids) &&
    identity.commitOids.length > 0 &&
    identity.commitOids.every((oid) => OID_PATTERN.test(oid)) &&
    identity.commitOids.at(-1) === entry.headOid &&
    DIGEST_PATTERN.test(identity.trailerDigest) &&
    DIGEST_PATTERN.test(identity.ownerFingerprint)
  );
}

export function validatePreCutoverReceipt({
  receipt,
  receiptPath,
  marker,
  entry,
  prNumber,
  subjectBranch,
  closureValid,
}) {
  const runId = `pre-cutover-pr-${prNumber}`;
  const valid =
    exactKeys(receipt, RECEIPT_KEYS) &&
    receipt.schemaVersion === CUTOVER_VERSION &&
    receipt.disposition === 'pre-cutover' &&
    receipt.reason === 'registered-open-pr' &&
    receipt.runId === runId &&
    receipt.generation === 0 &&
    receipt.revision === 0 &&
    receipt.prNumber === prNumber &&
    receipt.markerId === marker.markerId &&
    receiptPath === `.agents/evals/work-runs/${runId}/g0-r0.json` &&
    closureValid === true &&
    validReceiptIdentity(receipt.identity, marker, entry, subjectBranch) &&
    exactKeys(receipt.timestamps, ['claimedAt', 'readyAt']) &&
    receipt.timestamps.claimedAt === null &&
    receipt.timestamps.readyAt === entry.createdAt &&
    JSON.stringify(receipt.identity) === JSON.stringify(entry.identity);
  return valid ? { ok: true } : { ok: false, reason: 'stale-pre-cutover-receipt' };
}

function validateRegisteredReceipt(input, marker, entry) {
  const verdict = validatePreCutoverReceipt({
    receipt: input.receipt,
    receiptPath: input.receiptPath,
    marker,
    entry,
    prNumber: input.prNumber,
    subjectBranch: input.subjectBranch,
    closureValid: input.closureValid,
  });
  if (!verdict.ok) return { ok: false, reason: 'stale-pre-cutover-receipt' };
  if (input.currentChangeDigest !== entry.identity.changeDigest) {
    return { ok: false, reason: 'altered-pre-cutover-topic-change' };
  }
  return { ok: true, population: 'excluded', reason: 'registered-pre-cutover' };
}

export function validateCutoverRegistry(input) {
  if (input.markerAdditionCount === 0)
    return { ok: false, reason: 'missing-cutover-marker-addition' };
  if (input.markerAdditionCount !== 1)
    return { ok: false, reason: 'multiple-cutover-marker-additions' };
  const headVerdict = validateCutoverMarker(input.headMarker, { repository: input.repository });
  if (!headVerdict.ok) return headVerdict;
  if (input.baseMarker === null) {
    if (input.receipt?.disposition === 'pre-cutover') {
      return { ok: false, reason: 'introduction-pre-cutover-claim' };
    }
    return { ok: true, population: 'excluded', reason: 'introduction-cutover' };
  }
  const baseVerdict = validateCutoverMarker(input.baseMarker, { repository: input.repository });
  if (!baseVerdict.ok) return baseVerdict;
  if (JSON.stringify(input.baseMarker) !== JSON.stringify(input.headMarker)) {
    return { ok: false, reason: 'cutover-registry-mutated' };
  }
  if (input.receipt?.disposition !== 'pre-cutover') return { ok: true, population: 'post-cutover' };
  if (!Number.isInteger(input.prNumber) || input.prNumber < 1) {
    return { ok: false, reason: 'missing-pre-cutover-pr-identity' };
  }
  const entry = input.baseMarker.openPullRequests.find(({ number }) => number === input.prNumber);
  if (!entry) return { ok: false, reason: 'unregistered-pre-cutover-pr' };
  return validateRegisteredReceipt(input, input.baseMarker, entry);
}

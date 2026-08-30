import {
  cohortKey,
  decodeWorkRunReceipt,
  projectWorkRunDurations,
  reduceWorkRun,
} from './work-run-contract.mjs';
import {
  exactKeys,
  POST_PR_GROUNDS,
  receiptPathCoordinates,
  same,
  validatePostPrAuthorizationProjection,
} from './work-run-validation-foundation.mjs';

const STATE_LOST_RECEIPT_KEYS = Object.freeze([
  'schemaVersion',
  'disposition',
  'reason',
  'runId',
  'generation',
  'revision',
  'identity',
  'timestamps',
]);

function decodeReceipt(receiptValue) {
  try {
    const receipt = decodeWorkRunReceipt(receiptValue);
    if (receipt.disposition === 'pre-cutover') {
      return { ok: false, reason: 'pre-cutover-requires-registry' };
    }
    if (receipt.disposition !== 'invalid') {
      if (!Array.isArray(receipt.events) || receipt.events.length === 0) throw new Error();
      return { ok: true, receipt, state: reduceWorkRun(receipt.events) };
    }
    const timestampsValid =
      exactKeys(receipt.timestamps, ['claimedAt', 'readyAt']) &&
      receipt.timestamps.claimedAt === null &&
      receipt.timestamps.readyAt === null;
    if (
      receipt.reason !== 'state-lost' ||
      !exactKeys(receipt, STATE_LOST_RECEIPT_KEYS) ||
      receipt.generation !== 0 ||
      receipt.revision !== 0 ||
      !timestampsValid
    ) {
      throw new Error();
    }
    return { ok: true, receipt, state: null };
  } catch {
    return { ok: false, reason: 'malformed-receipt' };
  }
}

function validateCoordinates(receipt, receiptPath) {
  const validCoordinates =
    Number.isInteger(receipt.generation) &&
    receipt.generation >= 0 &&
    Number.isInteger(receipt.revision) &&
    receipt.revision >= 0;
  if (!validCoordinates) return { ok: false, reason: 'malformed-receipt' };
  if (!receiptPath) return { ok: true };
  const coordinates = receiptPathCoordinates(receiptPath);
  const matches =
    coordinates?.runId === receipt.runId &&
    coordinates.generation === receipt.generation &&
    coordinates.revision === receipt.revision;
  return matches ? { ok: true } : { ok: false, reason: 'receipt-path-mismatch' };
}

function validateProjection(receipt, state) {
  try {
    const durations = projectWorkRunDurations(receipt.events);
    const cohort =
      state.status === 'excluded' && state.lane === null && state.workKind === null
        ? null
        : { key: cohortKey(state), lane: state.lane, workKind: state.workKind };
    return same(receipt.durations, durations) && same(receipt.cohort, cohort);
  } catch {
    return false;
  }
}

function validateTerminal(receipt, state) {
  const included = receipt.disposition === 'included';
  const terminal = receipt.events.at(-1);
  const expectedStatus = included ? 'ready' : 'excluded';
  const expectedEvent = included ? 'work.ready' : 'work.excluded';
  const terminalTimestamp = included ? 'readyAt' : 'excludedAt';
  return (
    state.status === expectedStatus &&
    terminal.type === expectedEvent &&
    state.generation === receipt.generation &&
    state.revision === receipt.revision &&
    (included || receipt.reason === terminal.data?.reason) &&
    exactKeys(receipt.timestamps, ['claimedAt', terminalTimestamp]) &&
    receipt.timestamps.claimedAt === receipt.events[0].at &&
    receipt.timestamps[terminalTimestamp] === terminal.at
  );
}

function validateGenerationAuthorization(receipt) {
  if (receipt.generation === 0) {
    return receipt.authorization === undefined;
  }
  const reopens = receipt.events.filter(
    (event) =>
      event.type === 'work.reopened' &&
      event.data?.generation === receipt.generation &&
      event.data?.revision === 0,
  );
  const reopen = reopens[0];
  return (
    reopens.length === 1 &&
    POST_PR_GROUNDS.has(receipt.ground) &&
    validatePostPrAuthorizationProjection(receipt.authorization) &&
    reopen.data.ground === receipt.ground &&
    same(reopen.data.authorization, receipt.authorization) &&
    receipt.authorization.ground === receipt.ground
  );
}

export function validateWorkRunReceipt(receiptValue, { receiptPath = null } = {}) {
  const decoded = decodeReceipt(receiptValue);
  if (!decoded.ok) return decoded;
  const { receipt, state } = decoded;
  const coordinates = validateCoordinates(receipt, receiptPath);
  if (!coordinates.ok) return coordinates;
  if (receipt.disposition === 'invalid') return { ok: true, receipt, state };
  if (!['included', 'excluded'].includes(receipt.disposition)) {
    return { ok: false, reason: 'unsupported-disposition' };
  }
  if (!validateProjection(receipt, state) || !validateTerminal(receipt, state)) {
    return { ok: false, reason: 'malformed-receipt' };
  }
  if (receipt.disposition === 'excluded') {
    return receipt.generation === 0 && receipt.revision === 0
      ? { ok: true, receipt, state }
      : { ok: false, reason: 'malformed-receipt' };
  }
  return validateGenerationAuthorization(receipt)
    ? { ok: true, receipt, state }
    : { ok: false, reason: 'invalid-post-pr-authorization' };
}

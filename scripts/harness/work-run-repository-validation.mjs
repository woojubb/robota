import {
  authorizationValidationOptions,
  loadLiveAuthorizations,
} from './work-run-authorization-batch.mjs';
import {
  commitMessageMap,
  exactReceiptClosure,
  firstCommitTime,
  gitSecond,
  hasPathAt,
  identityAtReadyHead,
  immutableReceiptHistory,
  parseReceiptAt,
  repositoryName,
  tryGit,
  validateCommitCorrelation,
} from './work-run-git-adapter.mjs';
import { validateWorkRunReceipt } from './work-run-receipt-validation.mjs';
import {
  validateGenerationZero,
  validatePostPrGeneration,
} from './work-run-post-pr-validation.mjs';
import {
  authorizationsMatch,
  identitiesMatch,
  MAX_RANGE_RECEIPTS,
  receiptPathCoordinates,
  same,
} from './work-run-validation-foundation.mjs';
import {
  createWorkRunVerificationRuntime,
  isWorkRunVerificationBudgetError,
} from './work-run-verification-runtime.mjs';

const CUTOVER_PATH = '.agents/evals/work-runs/cutover-v1.json';
function receiptEventsArePrefix(candidate, latest) {
  if (!Array.isArray(candidate.events) || !Array.isArray(latest.events)) return false;
  if (candidate.events.length > latest.events.length) return false;
  return same(candidate.events, latest.events.slice(0, candidate.events.length));
}
function completeReceiptCoordinates(paths, latest) {
  if (paths.length > MAX_RANGE_RECEIPTS) return false;
  const actual = new Set();
  for (const receiptPath of paths) {
    const coordinates = receiptPathCoordinates(receiptPath);
    if (!coordinates || coordinates.runId !== latest.runId) return false;
    actual.add(`${coordinates.generation}/${coordinates.revision}`);
  }
  const expected = new Set(
    latest.events
      .filter((event) => event.type === 'work.ready')
      .map((event) => `${event.data.generation}/${event.data.revision}`),
  );
  return actual.size === expected.size && [...expected].every((value) => actual.has(value));
}
function verifyLiveAuthorization({
  candidate,
  repository,
  currentPrNumber,
  fetchAuthorization,
  runtime,
  liveAuthorizations,
}) {
  if (candidate.generation === 0 || candidate.revision !== 0) return { ok: true };
  if (!Number.isInteger(currentPrNumber)) return { ok: false, reason: 'current-pr-required' };
  if (candidate.authorization.prNumber !== currentPrNumber) {
    return { ok: false, reason: 'authorization-pr-mismatch' };
  }
  let liveAuthorization;
  const reopenedAt = candidate.events.find(
    (event) =>
      event.type === 'work.reopened' &&
      event.data?.generation === candidate.generation &&
      event.data?.revision === candidate.revision,
  )?.at;
  try {
    liveAuthorization = liveAuthorizations?.get(candidate.authorization.commentId);
    if (!liveAuthorization && typeof fetchAuthorization === 'function') {
      liveAuthorization = fetchAuthorization({
        repository,
        commentId: candidate.authorization.commentId,
        authorizedAt: reopenedAt ?? null,
        runtime,
      });
    }
  } catch (error) {
    if (isWorkRunVerificationBudgetError(error)) throw error;
    return { ok: false, reason: 'authorization-comment-unverified' };
  }
  return authorizationsMatch(liveAuthorization, candidate.authorization)
    ? { ok: true }
    : { ok: false, reason: 'authorization-comment-mismatch' };
}

function validateHistoryReceipt(options, receiptPath) {
  const value = parseReceiptAt(options.root, options.subjectCommit, receiptPath, options.runtime);
  const verdict = validateWorkRunReceipt(value, { receiptPath });
  if (!verdict.ok) return verdict;
  const candidate = verdict.receipt;
  if (
    candidate.runId !== options.latest.runId ||
    candidate.disposition !== 'included' ||
    !receiptEventsArePrefix(candidate, options.latest)
  ) {
    return { ok: false, reason: 'incomplete-or-foreign-receipt-history' };
  }
  return verifyLiveAuthorization({ ...options, candidate });
}
function validateReceiptHistory(options) {
  if (!completeReceiptCoordinates(options.paths, options.latest)) {
    return { ok: false, reason: 'incomplete-or-foreign-receipt-history' };
  }
  for (const receiptPath of options.paths) {
    const verdict = validateHistoryReceipt(options, receiptPath);
    if (!verdict.ok) return verdict;
  }
  return { ok: true };
}

function resolveRepositoryRefs({ root, baseRef, subjectRef, subjectBranch, runtime }) {
  const subjectCommit = tryGit(root, ['rev-parse', `${subjectRef}^{commit}`], runtime);
  if (!subjectCommit) return { ok: false, reason: 'subject-ref-unresolved' };
  const baseCommit = tryGit(root, ['rev-parse', `${baseRef}^{commit}`], runtime);
  if (!baseCommit) return { ok: false, reason: 'base-ref-unresolved' };
  const markerInBase = hasPathAt(root, baseCommit, CUTOVER_PATH, runtime);
  const markerInSubject = hasPathAt(root, subjectCommit, CUTOVER_PATH, runtime);
  if (!markerInBase && markerInSubject) {
    return {
      ok: true,
      terminal: { ok: true, population: 'excluded', reason: 'introduction-cutover' },
    };
  }
  if (!markerInBase) return { ok: false, reason: 'missing-cutover-marker' };
  const branch =
    subjectBranch ?? tryGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], runtime);
  return branch
    ? { ok: true, subjectCommit, baseCommit, branch }
    : { ok: false, reason: 'subject-branch-required' };
}

function loadReceiptContext(root, baseCommit, subjectCommit, runtime) {
  const history = immutableReceiptHistory(root, baseCommit, subjectCommit, runtime);
  if (!history.ok) return history;
  const closure = exactReceiptClosure(root, subjectCommit, runtime);
  if (!closure) return { ok: false, reason: 'invalid-closure-commit' };
  const value = parseReceiptAt(root, subjectCommit, closure.receiptPath, runtime);
  if (!value) return { ok: false, reason: 'malformed-receipt' };
  const verdict = validateWorkRunReceipt(value, { receiptPath: closure.receiptPath });
  return verdict.ok
    ? { ok: true, receipt: verdict.receipt, receiptPaths: history.paths, closure }
    : verdict;
}

function validateIdentityContext({
  root,
  repository,
  branch,
  baseCommit,
  closure,
  receipt,
  runtime,
}) {
  const expected = receipt.identity;
  if (
    !expected ||
    expected.repository !== repository ||
    expected.branch !== branch ||
    expected.baseCommit !== baseCommit
  ) {
    return { ok: false, reason: 'identity-mismatch' };
  }
  if (expected.headCommit !== closure.readyHead) {
    return { ok: false, reason: 'invalid-closure-commit' };
  }
  const actual = identityAtReadyHead({
    root,
    repository,
    branch,
    baseCommit,
    readyHead: closure.readyHead,
    runtime,
  });
  if (actual?.rangeExceeded) return { ok: false, reason: 'measurement-range-budget-exceeded' };
  if (!identitiesMatch(actual, expected)) return { ok: false, reason: 'identity-mismatch' };
  const messages = commitMessageMap(root, [...actual.commitOids, closure.closureCommit], runtime);
  return messages && validateCommitCorrelation(actual.commitOids, closure, receipt, messages)
    ? { ok: true, actual, messages }
    : { ok: false, reason: 'invalid-commit-trailers' };
}

function validateClaimTiming(root, receipt, firstCommitOid, runtime) {
  const claimedAt = receipt.timestamps?.claimedAt;
  const firstAt = firstCommitTime(root, firstCommitOid, runtime);
  const parsed = Date.parse(claimedAt ?? '');
  const late =
    claimedAt !== null &&
    (!Number.isFinite(parsed) || firstAt === null || gitSecond(parsed) > gitSecond(firstAt));
  return late ? { ok: false, reason: 'late-claim' } : { ok: true };
}

function finalDisposition(receipt) {
  if (receipt.disposition === 'invalid') {
    return { ok: true, population: 'invalid', runId: receipt.runId };
  }
  if (['included', 'excluded', 'pre-cutover'].includes(receipt.disposition)) {
    return {
      ok: true,
      population: receipt.disposition === 'included' ? 'included' : 'excluded',
      runId: receipt.runId,
    };
  }
  return { ok: false, reason: 'unsupported-disposition' };
}

function validateRepositoryWorkRunWithinRuntime(options) {
  if (['delete', 'no-content'].includes(options.operation ?? 'content')) {
    return { ok: true, population: 'outside-topic-range' };
  }
  const normalized = authorizationValidationOptions(options);
  const refs = resolveRepositoryRefs(normalized);
  if (!refs.ok || refs.terminal) return refs.terminal ?? refs;
  const loaded = loadReceiptContext(
    normalized.root,
    refs.baseCommit,
    refs.subjectCommit,
    normalized.runtime,
  );
  if (!loaded.ok) return loaded;
  const repository = repositoryName(normalized.root, normalized.runtime);
  const context = { ...normalized, ...refs, ...loaded, repository };
  const identity = validateIdentityContext(context);
  if (!identity.ok) return identity;
  Object.assign(context, identity);
  const live = loadLiveAuthorizations(context);
  if (!live.ok) return live;
  context.liveAuthorizations = live.authorizations;
  const history =
    loaded.receipt.disposition === 'included'
      ? validateReceiptHistory({ ...context, paths: loaded.receiptPaths, latest: loaded.receipt })
      : loaded.receiptPaths.length === 1
        ? { ok: true }
        : { ok: false, reason: 'incomplete-or-foreign-receipt-history' };
  if (!history.ok) return history;
  const g0 = validateGenerationZero(context);
  if (!g0.ok) return g0;
  const postPr = validatePostPrGeneration(context);
  if (!postPr.ok) return postPr;
  const timing = validateClaimTiming(
    normalized.root,
    loaded.receipt,
    identity.actual.commitOids[0],
    normalized.runtime,
  );
  return timing.ok ? finalDisposition(loaded.receipt) : timing;
}

export function validateRepositoryWorkRun(options) {
  if (['delete', 'no-content'].includes(options.operation ?? 'content')) {
    return { ok: true, population: 'outside-topic-range' };
  }
  const runtime = options.runtime ?? createWorkRunVerificationRuntime();
  try {
    return validateRepositoryWorkRunWithinRuntime({ ...options, runtime });
  } catch (error) {
    if (!isWorkRunVerificationBudgetError(error)) throw error;
    return { ok: false, reason: 'verification-budget-exhausted', detail: error.message };
  }
}

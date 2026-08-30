import { cohortKey, projectWorkRunDurations } from './work-run-contract.mjs';
import { validateWorkRunReceipt } from './work-run-validation.mjs';
import { createGitHubLookupBudget, joinPullRequest } from './work-run-report-github.mjs';

const PERCENT_SCALE = 100;
const P50 = 50;
const P90 = 90;

export function percentile(values, percent) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil((percent / PERCENT_SCALE) * ordered.length) - 1)];
}

function pair(values) {
  return { p50: percentile(values, P50), p90: percentile(values, P90) };
}

function reportIssue(disposition, reason) {
  return { disposition, reason, reportIssue: true };
}

export function normalizeWorkRunReceipt(candidate) {
  if (candidate?.reportIssue === true) return structuredClone(candidate);
  if (candidate?.disposition === 'abandoned' && candidate?.source === 'local-state') {
    return structuredClone(candidate);
  }
  const verdict = validateWorkRunReceipt(candidate);
  if (!verdict.ok) return reportIssue('invalid', verdict.reason ?? 'malformed-receipt');
  const receipt = verdict.receipt;
  if (!['included', 'excluded'].includes(receipt.disposition)) return receipt;
  try {
    return {
      ...receipt,
      cohort: {
        key: cohortKey(verdict.state),
        lane: verdict.state.lane,
        workKind: verdict.state.workKind,
      },
      durations: projectWorkRunDurations(receipt.events),
    };
  } catch {
    return reportIssue('invalid', 'malformed-receipt');
  }
}

function reworkByGroundFor(receipts) {
  const reworkByGround = {};
  for (const receipt of receipts) {
    const ground = receipt.ground ?? 'unknown';
    const entry = (reworkByGround[ground] ??= { count: 0, wallMs: 0 });
    entry.count += 1;
    entry.wallMs += receipt.durations?.wallMs ?? 0;
  }
  return reworkByGround;
}

function metricsFor(receipts) {
  const phaseNames = new Set(
    receipts.flatMap((receipt) => Object.keys(receipt.durations?.phases ?? {})),
  );
  const finite = (selector) => receipts.map(selector).filter(Number.isFinite);
  return {
    wallMs: pair(finite((receipt) => receipt.durations?.wallMs)),
    activeMs: pair(finite((receipt) => receipt.durations?.activeMs)),
    pausedMs: pair(finite((receipt) => receipt.durations?.pausedMs)),
    timeToFirstPrMs: pair(finite((receipt) => receipt.timeToFirstPrMs)),
    phases: Object.fromEntries(
      [...phaseNames]
        .sort()
        .map((phase) => [phase, pair(finite((receipt) => receipt.durations?.phases?.[phase]))]),
    ),
  };
}

function receiptCohort(receipt) {
  const cohort = receipt.cohort;
  if (
    typeof cohort?.key !== 'string' ||
    typeof cohort?.lane !== 'string' ||
    typeof cohort?.workKind !== 'string' ||
    cohort.key !== `${cohort.lane}/${cohort.workKind}`
  ) {
    return null;
  }
  return cohort;
}

function aggregateCohorts(root, rework) {
  const buckets = new Map();
  let unavailable = 0;
  const add = (receipt, kind) => {
    const cohort = receiptCohort(receipt);
    if (!cohort) {
      unavailable += 1;
      return;
    }
    const bucket = buckets.get(cohort.key) ?? { cohort, root: [], rework: [] };
    bucket[kind].push(receipt);
    buckets.set(cohort.key, bucket);
  };
  for (const receipt of root) add(receipt, 'root');
  for (const receipt of rework) add(receipt, 'rework');
  const cohorts = Object.fromEntries(
    [...buckets.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, bucket]) => [
        key,
        {
          cohort: structuredClone(bucket.cohort),
          populations: {
            included: bucket.root.length + bucket.rework.length,
            firstPr: bucket.root.length,
            rework: bucket.rework.length,
          },
          metrics: metricsFor(bucket.root),
          reworkByGround: reworkByGroundFor(bucket.rework),
        },
      ]),
  );
  return { cohorts, unavailable };
}

function incrementReason(reasons, reason) {
  reasons[reason] = (reasons[reason] ?? 0) + 1;
}

function queryFirstPullRequests(eligible, queryPullRequests, budget) {
  try {
    const results = queryPullRequests(eligible, { budget });
    if (Array.isArray(results) && results.length === eligible.length) return results;
    return eligible.map(() => ({ ok: false, reason: 'invalid-response' }));
  } catch {
    return eligible.map(() => ({ ok: false, reason: 'query-threw' }));
  }
}

function applyFirstPullRequest(receipt, queryResult, unavailableReasons) {
  const joined = joinPullRequest(receipt, queryResult);
  if (!joined.ok) {
    incrementReason(unavailableReasons, joined.reason);
    return { receipt, unavailable: 1 };
  }
  const claimedAt = Date.parse(receipt.timestamps?.claimedAt);
  const createdAt = Date.parse(joined.createdAt);
  if (!Number.isFinite(claimedAt) || !Number.isFinite(createdAt) || createdAt < claimedAt) {
    incrementReason(unavailableReasons, 'invalid-first-pr-timestamp');
    return { receipt, unavailable: 1 };
  }
  return {
    receipt: {
      ...receipt,
      firstPrAt: joined.createdAt,
      timeToFirstPrMs: createdAt - claimedAt,
      prNumber: joined.prNumber,
    },
    unavailable: 0,
  };
}

function projectFirstPullRequests(root, queryPullRequests, budget) {
  if (typeof queryPullRequests !== 'function') {
    return { receipts: root, unavailable: 0, unavailableReasons: {} };
  }
  const eligible = root.slice(0, budget.remainingReceipts);
  const overflow = root.slice(eligible.length);
  budget.remainingReceipts -= eligible.length;
  const unavailableReasons = {};
  const projected = [];
  let unavailable = 0;
  const results = queryFirstPullRequests(eligible, queryPullRequests, budget);
  for (const [index, receipt] of eligible.entries()) {
    const projection = applyFirstPullRequest(receipt, results[index], unavailableReasons);
    projected.push(projection.receipt);
    unavailable += projection.unavailable;
  }
  for (const receipt of overflow) {
    incrementReason(unavailableReasons, 'receipt-budget-exhausted');
    projected.push(receipt);
  }
  return { receipts: projected, unavailable: unavailable + overflow.length, unavailableReasons };
}

function selectLatest(normalized) {
  const latest = new Map();
  for (const receipt of normalized) {
    if (receipt.disposition !== 'included') continue;
    const key = `${receipt.runId}/${receipt.generation ?? 0}`;
    const previous = latest.get(key);
    if (!previous || (receipt.revision ?? 0) > (previous.revision ?? 0)) latest.set(key, receipt);
  }
  const selected = [...latest.values()];
  const superseded = normalized.filter((receipt) => {
    if (receipt.disposition !== 'included') return false;
    return latest.get(`${receipt.runId}/${receipt.generation ?? 0}`) !== receipt;
  }).length;
  return { selected, superseded };
}

function firstGenerationReceipts(selected) {
  const latestByRun = new Map();
  for (const receipt of selected) {
    const previous = latestByRun.get(receipt.runId);
    if (!previous || (receipt.generation ?? 0) > (previous.generation ?? 0)) {
      latestByRun.set(receipt.runId, receipt);
    }
  }
  return selected
    .filter((receipt) => (receipt.generation ?? 0) === 0)
    .map((receipt) => ({
      ...receipt,
      prJoinHeadCommit: latestByRun.get(receipt.runId)?.identity?.headCommit,
    }));
}

function countedReasons(receipts, disposition) {
  const reasons = {};
  for (const receipt of receipts.filter((candidate) => candidate.disposition === disposition)) {
    incrementReason(reasons, receipt.reason ?? 'unknown');
  }
  return reasons;
}

function mergeReasons(target, additions) {
  for (const [reason, count] of Object.entries(additions)) {
    target[reason] = (target[reason] ?? 0) + count;
  }
}

export function reportWorkRuns(
  receipts,
  { queryPullRequests, queryPullRequest, githubLimits } = {},
) {
  const normalized = receipts.map(normalizeWorkRunReceipt);
  const { selected, superseded } = selectLatest(normalized);
  const batchQuery =
    queryPullRequests ??
    (typeof queryPullRequest === 'function'
      ? (batch, context) => batch.map((receipt) => queryPullRequest(receipt, context))
      : undefined);
  const budget =
    typeof batchQuery === 'function' ? createGitHubLookupBudget(githubLimits) : undefined;
  const firstPr = projectFirstPullRequests(firstGenerationReceipts(selected), batchQuery, budget);
  const root = firstPr.receipts;
  const rework = selected.filter((receipt) => (receipt.generation ?? 0) > 0);
  const cohorts = aggregateCohorts(root, rework);
  const unavailableReasons = countedReasons(normalized, 'unavailable');
  mergeReasons(unavailableReasons, firstPr.unavailableReasons);
  if (cohorts.unavailable > 0)
    unavailableReasons['missing-or-invalid-cohort'] = cohorts.unavailable;
  const abandoned = normalized.filter((receipt) => receipt.disposition === 'abandoned');
  return {
    populations: {
      included: selected.length,
      superseded,
      excluded: normalized.filter((receipt) =>
        ['excluded', 'pre-cutover'].includes(receipt.disposition),
      ).length,
      invalid: normalized.filter((receipt) => receipt.disposition === 'invalid').length,
      abandoned: abandoned.length,
      unavailable:
        normalized.filter((receipt) => receipt.disposition === 'unavailable').length +
        firstPr.unavailable +
        cohorts.unavailable,
    },
    metrics: metricsFor(root),
    firstPrRuns: root.filter((receipt) => Boolean(receipt.firstPrAt)),
    reworkByGround: reworkByGroundFor(rework),
    cohorts: cohorts.cohorts,
    abandonedRuns: abandoned,
    abandonedMetrics: metricsFor(abandoned),
    invalidReasons: countedReasons(normalized, 'invalid'),
    unavailableReasons,
  };
}

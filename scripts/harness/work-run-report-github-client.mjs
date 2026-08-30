import { spawnSync } from 'node:child_process';

const KIBIBYTE = 1024;

export const GITHUB_DEFAULTS = Object.freeze({
  timeoutMs: 15_000,
  // eslint-disable-next-line no-magic-numbers -- one response may consume at most 8 MiB
  maxBytes: 8 * KIBIBYTE * KIBIBYTE,
  maxPages: 10,
  maxCandidates: 10,
  maxReceipts: 10,
  maxRequests: 25,
  maxSearchQueryBytes: 240,
});

export function adapterFailure(reason, detail) {
  const error = new Error(detail);
  error.adapterReason = reason;
  return error;
}

export function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function createGitHubLookupBudget({
  totalTimeoutMs = GITHUB_DEFAULTS.timeoutMs,
  maxReceipts = GITHUB_DEFAULTS.maxReceipts,
  maxRequests = GITHUB_DEFAULTS.maxRequests,
  maxPages = GITHUB_DEFAULTS.maxPages,
  maxCandidates = GITHUB_DEFAULTS.maxCandidates,
  now = Date.now,
} = {}) {
  const startedAt = now();
  return {
    deadlineAt: startedAt + positiveInteger(totalTimeoutMs, 'totalTimeoutMs'),
    remainingReceipts: positiveInteger(maxReceipts, 'maxReceipts'),
    remainingRequests: positiveInteger(maxRequests, 'maxRequests'),
    remainingPages: positiveInteger(maxPages, 'maxPages'),
    remainingCandidates: positiveInteger(maxCandidates, 'maxCandidates'),
    now,
  };
}

export function consumeBudget(budget, field, amount, reason) {
  if (!budget) return;
  if (!Number.isInteger(amount) || amount < 0) {
    throw adapterFailure('invalid-response', `GitHub ${field} usage is invalid`);
  }
  if (budget[field] < amount) {
    throw adapterFailure(reason, `GitHub ${field} budget exhausted`);
  }
  budget[field] -= amount;
}

function githubFailureReason(stderr) {
  return /\b(?:api\s+|secondary\s+)?rate[- ]limit(?:\s+exceeded)?\b/iu.test(stderr)
    ? 'rate-limit'
    : 'query-failed';
}

export function runGitHubJson(
  args,
  {
    runGh = spawnSync,
    timeoutMs = GITHUB_DEFAULTS.timeoutMs,
    maxBytes = GITHUB_DEFAULTS.maxBytes,
    budget,
  },
) {
  consumeBudget(budget, 'remainingRequests', 1, 'request-budget-exhausted');
  const remainingMs = budget ? Math.floor(budget.deadlineAt - budget.now()) : timeoutMs;
  if (remainingMs <= 0) throw adapterFailure('timeout', 'GitHub lookup budget timed out');
  const result = runGh('gh', args, {
    encoding: 'utf8',
    timeout: Math.min(timeoutMs, remainingMs),
    maxBuffer: maxBytes,
  });
  if (result.error?.code === 'ETIMEDOUT') {
    throw adapterFailure('timeout', `GitHub query timed out after ${timeoutMs}ms`);
  }
  if (result.error) throw adapterFailure('query-failed', result.error.message);
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? '').trim();
    throw adapterFailure(githubFailureReason(stderr), stderr || 'gh failed');
  }
  try {
    return JSON.parse(String(result.stdout));
  } catch (error) {
    throw adapterFailure('invalid-response', `GitHub returned invalid JSON: ${error.message}`);
  }
}

export function completeSearchItems(pages, maxPages) {
  if (!Array.isArray(pages) || pages.length > maxPages || pages.length === 0) {
    throw adapterFailure('incomplete-pagination', 'GitHub search page envelope is incomplete');
  }
  const total = pages[0]?.total_count;
  if (!Number.isInteger(total) || total < 0) {
    throw adapterFailure('incomplete-pagination', 'GitHub search total is missing');
  }
  const items = [];
  for (const page of pages) {
    if (
      page?.total_count !== total ||
      page.incomplete_results !== false ||
      !Array.isArray(page.items)
    ) {
      throw adapterFailure('incomplete-pagination', 'GitHub search pagination is incomplete');
    }
    items.push(...page.items);
  }
  if (items.length !== total) {
    throw adapterFailure('incomplete-pagination', 'GitHub search did not return every result');
  }
  return items;
}

export function completeCommitList(pages, maxPages) {
  if (
    !Array.isArray(pages) ||
    pages.length > maxPages ||
    pages.some((page) => !Array.isArray(page))
  ) {
    throw adapterFailure('incomplete-pagination', 'GitHub commit pagination is incomplete');
  }
  return pages.flat();
}

import { spawnSync } from 'node:child_process';

import { takeWorkRunVerificationQuery } from './work-run-verification-runtime.mjs';

const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const GITHUB_BUFFER_BYTES = 4 * 1024 * 1024;
const REQUEST_BUDGET = 100;
const QUERY_BUDGET_MS = 15_000;
const SERVER_TICK_POLL_MS = 250;

export function openingHeadBody(runId, headOid) {
  return `Work-Run-Opening-Head: v1\nWork-Run: ${runId}\nHead-Oid: ${headOid}`;
}

function requestTimeout(budget) {
  if (typeof budget.now === 'function') return takeWorkRunVerificationQuery(budget);
  if (budget.remaining < 1) throw new Error('GitHub opening-head request budget exhausted');
  budget.remaining -= 1;
  const remainingMs = budget.deadline - Date.now();
  if (remainingMs < 1) throw new Error('GitHub opening-head query timed out');
  return Math.min(10_000, remainingMs);
}

function runJson(root, run, args, budget) {
  const result = run('gh', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: requestTimeout(budget),
    maxBuffer: GITHUB_BUFFER_BYTES,
  });
  if (result.error || result.status !== 0) {
    throw new Error('GitHub opening-head comment query failed');
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error('GitHub opening-head comment response is invalid');
  }
}

function defaultWait(durationMs) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, durationMs);
}

function githubServerTime(root, run, budget) {
  const result = run('gh', ['api', '--include', '-X', 'GET', '/rate_limit'], {
    cwd: root,
    encoding: 'utf8',
    timeout: requestTimeout(budget),
    maxBuffer: GITHUB_BUFFER_BYTES,
  });
  if (result.error || result.status !== 0) {
    throw new Error('GitHub server timestamp query failed');
  }
  const dateHeader = /^date:\s*(.+)$/imu.exec(result.stdout)?.[1]?.trim();
  const serverTime = Date.parse(dateHeader ?? '');
  if (!Number.isFinite(serverTime)) throw new Error('GitHub server timestamp response is invalid');
  return serverTime;
}

function waitForLaterServerTick(root, createdAt, run, wait, budget) {
  const commentTime = Date.parse(createdAt ?? '');
  if (!Number.isFinite(commentTime)) throw new Error('opening-head comment timestamp is invalid');
  while (true) {
    const serverTime = githubServerTime(root, run, budget);
    if (serverTime > commentTime) return new Date(serverTime).toISOString();
    const remainingMs = budget.deadline - Date.now();
    if (remainingMs <= SERVER_TICK_POLL_MS) {
      throw new Error('GitHub server timestamp did not advance after opening-head attestation');
    }
    wait(SERVER_TICK_POLL_MS);
  }
}

function commentPage(root, repository, headOid, page, run, budget) {
  return runJson(
    root,
    run,
    [
      'api',
      '-X',
      'GET',
      `/repos/${repository}/commits/${headOid}/comments?per_page=${PAGE_SIZE}&page=${page}`,
    ],
    budget,
  );
}

function commitComments(root, repository, headOid, run, budget) {
  const comments = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = commentPage(root, repository, headOid, page, run, budget);
    if (!Array.isArray(batch)) throw new Error('GitHub opening-head comments are incomplete');
    comments.push(...batch);
    if (batch.length < PAGE_SIZE) return comments;
  }
  throw new Error('GitHub opening-head comments exceed the evidence budget');
}

function validComment(comment, headOid, expectedBody, latestAt = null) {
  const createdAt = Date.parse(comment?.created_at ?? '');
  const updatedAt = Date.parse(comment?.updated_at ?? '');
  return (
    Number.isInteger(comment?.id) &&
    comment.commit_id === headOid &&
    comment.body === expectedBody &&
    Number.isFinite(createdAt) &&
    createdAt === updatedAt &&
    (latestAt === null || createdAt < latestAt)
  );
}

export function attestedOpeningHead(
  root,
  repository,
  prCreatedAt,
  { runId, headOid },
  {
    run = spawnSync,
    budget = { remaining: REQUEST_BUDGET, deadline: Date.now() + QUERY_BUDGET_MS },
  } = {},
) {
  const comments = commitComments(root, repository, headOid, run, budget);
  return attestedOpeningHeadFromComments(comments, prCreatedAt, { runId, headOid });
}

export function attestedOpeningHeadFromComments(comments, prCreatedAt, { runId, headOid }) {
  const latestAt = Date.parse(prCreatedAt ?? '');
  if (
    !Array.isArray(comments) ||
    !Number.isFinite(latestAt) ||
    !OID_PATTERN.test(headOid ?? '') ||
    !runId
  ) {
    throw new Error('GitHub opening-head coordinates are invalid');
  }
  const expectedBody = openingHeadBody(runId, headOid);
  const matches = comments.filter((comment) => comment?.body === expectedBody);
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error('GitHub pre-PR opening-head comment is duplicated');
  }
  if (matches.some((comment) => !validComment(comment, headOid, expectedBody, latestAt))) {
    throw new Error('GitHub pre-PR opening-head comment was edited or late');
  }
  return headOid;
}

function createOrReuseOpeningComment(root, repository, coordinates, run, budget) {
  const { runId, headOid } = coordinates;
  const body = openingHeadBody(runId, headOid);
  const existing = commitComments(root, repository, headOid, run, budget).filter(
    (comment) => comment?.body === body,
  );
  if (existing.length > 1) {
    throw new Error('opening-head comment is duplicated');
  }
  if (existing.some((comment) => !validComment(comment, headOid, body))) {
    throw new Error('opening-head comment was edited or is malformed');
  }
  const created =
    existing[0] ??
    runJson(
      root,
      run,
      [
        'api',
        '-X',
        'POST',
        '-f',
        `body=${body}`,
        `/repos/${repository}/commits/${headOid}/comments`,
      ],
      budget,
    );
  if (!validComment(created, headOid, body)) {
    throw new Error('GitHub opening-head comment creation was not authoritative');
  }
  return { created, status: existing.length > 0 ? 'existing' : 'created' };
}

export function createOpeningHeadComment(
  root,
  repository,
  { runId, headOid },
  {
    run = spawnSync,
    wait = defaultWait,
    budget = { remaining: REQUEST_BUDGET, deadline: Date.now() + QUERY_BUDGET_MS },
  } = {},
) {
  if (!OID_PATTERN.test(headOid ?? '') || !runId) {
    throw new Error('opening-head comment coordinates are invalid');
  }
  const { created, status } = createOrReuseOpeningComment(
    root,
    repository,
    { runId, headOid },
    run,
    budget,
  );
  return {
    status,
    commentId: created.id,
    commentCreatedAt: created.created_at,
    serverAdvancedAt: waitForLaterServerTick(root, created.created_at, run, wait, budget),
  };
}

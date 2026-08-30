import { existsSync, readFileSync } from 'node:fs';

import { validateCutoverRegistry } from './work-run-cutover-scan.mjs';
import { currentCutoverDigest } from './work-run-cutover-digest.mjs';
import { git, repositoryName } from './work-run-git-adapter.mjs';
import { resolvePullRequestHistoryContext } from './work-run-pr-evidence.mjs';
import { isWorkRunVerificationBudgetError } from './work-run-verification-runtime.mjs';

const CUTOVER_PATH = '.agents/evals/work-runs/cutover-v1.json';
const SUBJECT_OID_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i;
const PROTECTED_SUBJECT_BRANCHES = new Set(['develop', 'main', 'master']);

export function option(argv, name) {
  const at = argv.indexOf(name);
  return at === -1 ? null : (argv[at + 1] ?? null);
}

export function resolveScanSubject({
  argv = [],
  env = process.env,
  currentBranch = null,
  readEvent = (file) => readFileSync(file, 'utf8'),
} = {}) {
  const explicitSha =
    option(argv, '--subject-sha') ??
    option(argv, '--head') ??
    env.PR_HEAD_SHA ??
    env.GITHUB_PR_HEAD_SHA;
  const explicitBranch = option(argv, '--subject-branch') ?? env.GITHUB_HEAD_REF;
  if (explicitSha !== null && explicitSha !== undefined) {
    if (!SUBJECT_OID_PATTERN.test(explicitSha) || !explicitBranch) {
      throw new Error('work-run-measurement: explicit PR subject needs a valid SHA and branch');
    }
    return { subjectRef: explicitSha, subjectBranch: explicitBranch };
  }
  if (env.GITHUB_EVENT_PATH) {
    try {
      const event = JSON.parse(readEvent(env.GITHUB_EVENT_PATH));
      if (
        SUBJECT_OID_PATTERN.test(event.pull_request?.head?.sha ?? '') &&
        event.pull_request?.head?.ref
      ) {
        return {
          subjectRef: event.pull_request.head.sha,
          subjectBranch: event.pull_request.head.ref,
        };
      }
    } catch {
      throw new Error('work-run-measurement: GitHub pull-request event could not be read');
    }
  }
  if (env.GITHUB_EVENT_NAME === 'pull_request' || env.GITHUB_HEAD_REF) {
    throw new Error(
      'work-run-measurement: actual pull-request head SHA and branch are required; refusing synthetic merge HEAD',
    );
  }
  if (!currentBranch)
    throw new Error('work-run-measurement: local topic branch could not be resolved');
  return { subjectRef: 'HEAD', subjectBranch: currentBranch };
}

function explicitPrContext(argv, env) {
  const number = Number(option(argv, '--pr') ?? env.GITHUB_PR_NUMBER);
  if (!Number.isInteger(number) || number < 1) return null;
  return {
    status: 'open',
    number,
    createdAt: option(argv, '--pr-created-at') ?? env.GITHUB_PR_CREATED_AT ?? null,
  };
}

function eventPrContext(env, readEvent) {
  if (!env.GITHUB_EVENT_PATH || !existsSync(env.GITHUB_EVENT_PATH)) return null;
  try {
    const event = JSON.parse(readEvent(env.GITHUB_EVENT_PATH));
    const number = Number(event.pull_request?.number ?? event.number);
    if (Number.isInteger(number) && number > 0) {
      return { status: 'open', number, createdAt: event.pull_request?.created_at ?? null };
    }
    return env.GITHUB_EVENT_NAME === 'pull_request'
      ? { status: 'unavailable', reason: 'pull-request-event-incomplete' }
      : null;
  } catch {
    return { status: 'unavailable', reason: 'pull-request-event-invalid' };
  }
}

export function resolveScanPrContext({
  root,
  subjectBranch,
  argv = [],
  env = process.env,
  readEvent = (file) => readFileSync(file, 'utf8'),
  query = resolvePullRequestHistoryContext,
  runtime = null,
}) {
  const explicit = explicitPrContext(argv, env);
  if (explicit) return explicit;
  const event = eventPrContext(env, readEvent);
  if (event) return event;
  if (!subjectBranch) return { status: 'unavailable', reason: 'subject-branch-missing' };
  return query(root, subjectBranch, { runtime });
}

function readMarkerAt(root, revision, runtime) {
  try {
    return JSON.parse(git(root, ['show', `${revision}:${CUTOVER_PATH}`], { runtime }));
  } catch (error) {
    if (isWorkRunVerificationBudgetError(error)) throw error;
    if (error?.status === 128) return null;
    return { parseError: true };
  }
}

function markerAdditionCount(root, range, runtime) {
  const output = git(root, ['log', '--diff-filter=A', '--format=%H', range, '--', CUTOVER_PATH], {
    runtime,
  });
  return output ? output.split('\n').length : 0;
}

function receiptRecordForRunAt(root, subjectRef, runId, runtime) {
  if (!/^[A-Za-z0-9._-]+$/.test(runId ?? '')) return null;
  const directory = `.agents/evals/work-runs/${runId}`;
  let files;
  try {
    files = git(root, ['ls-tree', '-r', '--name-only', subjectRef, '--', directory], { runtime })
      .split('\n')
      .filter((file) => file.endsWith('.json'));
  } catch (error) {
    if (isWorkRunVerificationBudgetError(error)) throw error;
    return null;
  }
  const receipts = [];
  for (const file of files) {
    try {
      const receipt = JSON.parse(git(root, ['show', `${subjectRef}:${file}`], { runtime }));
      if (receipt.runId === runId) receipts.push({ receipt, receiptPath: file });
    } catch (error) {
      if (isWorkRunVerificationBudgetError(error)) throw error;
      return null;
    }
  }
  return receipts.length === 1 ? receipts[0] : null;
}

export function receiptForRunAt(root, subjectRef, runId, runtime = null) {
  return receiptRecordForRunAt(root, subjectRef, runId, runtime)?.receipt ?? null;
}

function exactReceiptOnlyClosure(root, subjectRef, receiptPath, runtime) {
  try {
    const ancestry = git(root, ['rev-list', '--parents', '-n', '1', subjectRef], {
      runtime,
    }).split(' ');
    if (ancestry.length !== 2) return false;
    const changes = git(
      root,
      [
        'diff-tree',
        '--no-commit-id',
        '--name-status',
        '--no-renames',
        '-r',
        ancestry[1],
        ancestry[0],
      ],
      { runtime },
    )
      .split('\n')
      .filter(Boolean);
    return changes.length === 1 && changes[0] === `A\t${receiptPath}`;
  } catch (error) {
    if (isWorkRunVerificationBudgetError(error)) throw error;
    return false;
  }
}

function cutoverReceiptContext(root, subject, baseMarker, prNumber, runtime) {
  const entry = baseMarker?.openPullRequests?.find(({ number }) => number === prNumber);
  const record = entry
    ? receiptRecordForRunAt(root, subject.subjectRef, `pre-cutover-pr-${prNumber}`, runtime)
    : null;
  const receiptPath = record?.receiptPath ?? null;
  return {
    entry,
    receipt: record?.receipt ?? null,
    receiptPath,
    closureValid:
      receiptPath !== null &&
      exactReceiptOnlyClosure(root, subject.subjectRef, receiptPath, runtime),
  };
}

export function inspectCutover({
  root,
  baseRef,
  subject,
  env,
  currentPrNumber,
  receiptOverride = null,
  runtime = null,
}) {
  const baseMarker = readMarkerAt(root, baseRef, runtime);
  const subjectMarker = readMarkerAt(root, subject.subjectRef, runtime);
  const context = cutoverReceiptContext(root, subject, baseMarker, currentPrNumber, runtime);
  const receipt = receiptOverride ?? context.receipt;
  if (context.entry && receipt === null)
    return { ok: false, reason: 'missing-pre-cutover-receipt' };
  let currentChangeDigest = null;
  try {
    currentChangeDigest = currentCutoverDigest(root, baseRef, subject.subjectRef, context, runtime);
  } catch (error) {
    if (isWorkRunVerificationBudgetError(error)) throw error;
    return { ok: false, reason: 'unverifiable-pre-cutover-topic-change' };
  }
  const range = baseMarker === null ? `${baseRef}..${subject.subjectRef}` : baseRef;
  return validateCutoverRegistry({
    baseMarker,
    headMarker: context.entry && subjectMarker === null ? baseMarker : subjectMarker,
    markerAdditionCount: markerAdditionCount(root, range, runtime),
    repository: env.GITHUB_REPOSITORY ?? repositoryName(root, runtime),
    prNumber: currentPrNumber,
    receipt,
    receiptPath: context.receiptPath,
    subjectBranch: subject.subjectBranch,
    closureValid: context.closureValid,
    currentChangeDigest,
  });
}

export function changedRange(root, baseRef, subjectRef, receiptRunId, runtime = null) {
  const mergeBase = git(root, ['merge-base', baseRef, subjectRef], { runtime });
  const changedPaths = git(root, ['diff', '--name-only', '-z', `${mergeBase}..${subjectRef}`], {
    runtime,
  })
    .split('\0')
    .filter(Boolean)
    .filter((file) => !file.startsWith(`.agents/evals/work-runs/${receiptRunId}/`));
  const textAt = (revision) => (file) => {
    try {
      return git(root, ['show', `${revision}:${file}`], { runtime });
    } catch (error) {
      if (isWorkRunVerificationBudgetError(error)) throw error;
      return null;
    }
  };
  return {
    changedPaths,
    beforeTextForPath: textAt(mergeBase),
    afterTextForPath: textAt(subjectRef),
  };
}

export function isLocalProtectedSubject({ subjectRef, subjectBranch, env = process.env }) {
  return (
    subjectRef === 'HEAD' &&
    PROTECTED_SUBJECT_BRANCHES.has(subjectBranch ?? '') &&
    !env.GITHUB_ACTIONS &&
    !env.GITHUB_EVENT_NAME &&
    !env.GITHUB_HEAD_REF
  );
}

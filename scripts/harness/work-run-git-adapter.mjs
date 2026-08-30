import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { exactWorkRunReceiptTrailers } from './work-run-commit-trailers.mjs';
import {
  MAX_RANGE_COMMITS,
  MAX_RANGE_RECEIPTS,
  OID_PATTERN,
  receiptPathCoordinates,
} from './work-run-validation-foundation.mjs';
import {
  isWorkRunVerificationBudgetError,
  takeWorkRunVerificationCommand,
} from './work-run-verification-runtime.mjs';

const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;

export function git(root, args, options = {}) {
  const { runtime, timeout = GIT_TIMEOUT_MS, ...commandOptions } = options;
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: runtime ? Math.min(timeout, takeWorkRunVerificationCommand(runtime)) : timeout,
    maxBuffer: GIT_MAX_BUFFER,
    ...commandOptions,
  }).trim();
}

export function gitBytes(root, args, options = {}) {
  const { runtime, timeout = GIT_TIMEOUT_MS, ...commandOptions } = options;
  return execFileSync('git', args, {
    cwd: root,
    timeout: runtime ? Math.min(timeout, takeWorkRunVerificationCommand(runtime)) : timeout,
    maxBuffer: GIT_MAX_BUFFER,
    ...commandOptions,
    encoding: 'buffer',
  });
}

export function tryGit(root, args, runtime = null) {
  try {
    return git(root, args, { runtime, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (error) {
    if (isWorkRunVerificationBudgetError(error)) throw error;
    return null;
  }
}

export function tryGitBytes(root, args, runtime = null) {
  try {
    return gitBytes(root, args, { runtime, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (error) {
    if (isWorkRunVerificationBudgetError(error)) throw error;
    return null;
  }
}

export function hasPathAt(root, revision, file, runtime = null) {
  return tryGit(root, ['cat-file', '-e', `${revision}:${file}`], runtime) !== null;
}

export function repositoryName(root, runtime = null) {
  const configured = git(root, ['config', '--get', 'remote.origin.url'], { runtime });
  return configured.replace(/^.*github\.com[/:]/, '').replace(/\.git$/, '');
}

export function exactReceiptClosure(root, subjectCommit, runtime = null) {
  const ancestry = git(root, ['rev-list', '--parents', '-n', '1', subjectCommit], {
    runtime,
  }).split(' ');
  if (ancestry.length !== 2) return null;
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
  if (changes.length !== 1) return null;
  const [status, receiptPath] = changes[0].split('\t');
  if (status !== 'A' || !receiptPathCoordinates(receiptPath)) return null;
  return { closureCommit: ancestry[0], readyHead: ancestry[1], receiptPath };
}

export function immutableReceiptHistory(root, baseCommit, subjectCommit, runtime = null) {
  const history = tryGit(
    root,
    [
      'log',
      `--max-count=${MAX_RANGE_COMMITS + 1}`,
      '--format=',
      '--name-status',
      '--no-renames',
      `${baseCommit}..${subjectCommit}`,
      '--',
      '.agents/evals/work-runs',
    ],
    runtime,
  );
  if (history === null) return { ok: false, reason: 'mutable-prior-receipt' };
  const changes = new Map();
  for (const line of history.split('\n').filter(Boolean)) {
    const [status, receiptPath] = line.split('\t');
    if (!receiptPathCoordinates(receiptPath)) continue;
    const prior = changes.get(receiptPath) ?? [];
    prior.push(status);
    changes.set(receiptPath, prior);
    if (changes.size > MAX_RANGE_RECEIPTS) {
      return { ok: false, reason: 'measurement-range-budget-exceeded' };
    }
  }
  if (![...changes.values()].every((statuses) => statuses.length === 1 && statuses[0] === 'A')) {
    return { ok: false, reason: 'mutable-prior-receipt' };
  }
  return { ok: true, paths: [...changes.keys()].sort() };
}

function ownerFingerprint(root, readyHead, runtime) {
  try {
    const source = gitBytes(root, ['show', `${readyHead}:scripts/harness/work-run-contract.mjs`], {
      runtime,
    });
    return createHash('sha256').update(source).digest('hex');
  } catch (error) {
    if (isWorkRunVerificationBudgetError(error)) throw error;
    return null;
  }
}

function topicCommitOids(root, baseCommit, readyHead, runtime) {
  const output = tryGit(
    root,
    [
      'rev-list',
      '--reverse',
      `--max-count=${MAX_RANGE_COMMITS + 1}`,
      `${baseCommit}..${readyHead}`,
    ],
    runtime,
  );
  return output === null ? null : output.split('\n').filter(Boolean);
}

function trailerDigest(root, baseCommit, readyHead, runtime) {
  const messages = tryGit(
    root,
    [
      'log',
      `--max-count=${MAX_RANGE_COMMITS + 1}`,
      '--format=%H%x00%B%x00',
      `${baseCommit}..${readyHead}`,
    ],
    runtime,
  );
  return messages === null ? null : createHash('sha256').update(messages).digest('hex');
}

export function identityAtReadyHead({ root, repository, branch, baseCommit, readyHead, runtime }) {
  const commitOids = topicCommitOids(root, baseCommit, readyHead, runtime);
  const fingerprint = ownerFingerprint(root, readyHead, runtime);
  const digest = trailerDigest(root, baseCommit, readyHead, runtime);
  if (commitOids === null || fingerprint === null || digest === null) return null;
  return {
    repository,
    branch,
    baseCommit,
    headCommit: readyHead,
    headTree: git(root, ['rev-parse', `${readyHead}^{tree}`], { runtime }),
    commitOids,
    trailerDigest: digest,
    ownerFingerprint: fingerprint,
    rangeExceeded: commitOids.length > MAX_RANGE_COMMITS,
  };
}

function exactTrailers(message) {
  let trailers;
  try {
    trailers = exactWorkRunReceiptTrailers(message);
  } catch {
    return null;
  }
  const receiptMatch = /^g(\d+)-r(\d+)$/.exec(trailers.receiptId);
  if (!receiptMatch) return null;
  return {
    runId: trailers.runId,
    receipt: trailers.receiptId,
    generation: Number(receiptMatch[1]),
    revision: Number(receiptMatch[2]),
  };
}

export function commitMessageMap(root, commitOids, runtime = null) {
  if (commitOids.length === 0 || commitOids.length > MAX_RANGE_COMMITS + 1) return null;
  const output = tryGit(root, ['show', '-s', '--format=%H%x00%B%x00', ...commitOids], runtime);
  if (output === null) return null;
  const parts = output.split('\0');
  const messages = new Map();
  for (let index = 0; index + 1 < parts.length; index += 2) {
    const oid = parts[index].trim();
    if (OID_PATTERN.test(oid)) messages.set(oid, parts[index + 1]);
  }
  return messages;
}

export function validateCommitCorrelation(commitOids, closure, receipt, messages) {
  const currentReceipt = `g${receipt.generation}-r${receipt.revision}`;
  for (const oid of [...commitOids, closure.closureCommit]) {
    const trailers = exactTrailers(messages.get(oid) ?? '');
    if (!trailers || trailers.runId !== receipt.runId) return false;
    const futureGeneration = trailers.generation > receipt.generation;
    const futureRevision =
      trailers.generation === receipt.generation && trailers.revision > receipt.revision;
    if (futureGeneration || futureRevision) return false;
    if ([closure.readyHead, closure.closureCommit].includes(oid)) {
      if (trailers.receipt !== currentReceipt) return false;
    }
  }
  return commitOids.length > 0;
}

export function authorizationBoundaryHead(commitOids, generation, baseCommit, messages) {
  const first = commitOids.findIndex((oid) => {
    const trailers = exactTrailers(messages.get(oid) ?? '');
    return trailers?.generation === generation;
  });
  if (first < 0) return null;
  return first === 0 ? baseCommit : commitOids[first - 1];
}

export function parseReceiptAt(root, subjectCommit, receiptPath, runtime = null) {
  try {
    return JSON.parse(git(root, ['show', `${subjectCommit}:${receiptPath}`], { runtime }));
  } catch (error) {
    if (isWorkRunVerificationBudgetError(error)) throw error;
    return null;
  }
}

export function firstCommitTime(root, oid, runtime = null) {
  const instant = Date.parse(tryGit(root, ['show', '-s', '--format=%cI', oid], runtime) ?? '');
  return Number.isFinite(instant) ? instant : null;
}

export function gitSecond(instant) {
  return Math.floor(instant / 1_000);
}

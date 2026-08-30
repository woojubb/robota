import { spawnSync } from 'node:child_process';

import { resolveBaseRef, WORKSPACE_ROOT } from './shared.mjs';
import { resolvePrePushSubject } from './pre-push-work-run.mjs';

const OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const DEFAULT_COMMAND_BUDGET = 8;
const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
const DEFAULT_TOTAL_COMMAND_TIMEOUT_MS = 15_000;

function defaultRunCommand(command, args, { timeout }) {
  const result = spawnSync(command, args, {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  };
}

export { resolvePrePushSubject as selectPushBoundBranch };

function parseCandidates(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isTrustedCandidate(value, branch) {
  return (
    value !== null &&
    typeof value === 'object' &&
    value.state === 'OPEN' &&
    value.isCrossRepository === false &&
    value.headRefName === branch &&
    typeof value.baseRefName === 'string' &&
    value.baseRefName.length > 0 &&
    typeof value.baseRefOid === 'string' &&
    OBJECT_ID_PATTERN.test(value.baseRefOid)
  );
}

const positiveInteger = (value, fallbackValue) =>
  Number.isSafeInteger(value) && value > 0 ? value : fallbackValue;

function createCommandRuntime(options) {
  const now = options.now ?? Date.now;
  const totalCommandTimeoutMs = positiveInteger(
    options.totalCommandTimeoutMs,
    DEFAULT_TOTAL_COMMAND_TIMEOUT_MS,
  );
  return {
    commandTimeoutMs: positiveInteger(options.commandTimeoutMs, DEFAULT_COMMAND_TIMEOUT_MS),
    commandsRemaining: positiveInteger(options.commandBudget, DEFAULT_COMMAND_BUDGET),
    deadlineAt: now() + totalCommandTimeoutMs,
    now,
    runCommand: options.runCommand ?? defaultRunCommand,
  };
}

function runBaseCommand(runtime, command, args, operation, exitFailureReason) {
  if (runtime.commandsRemaining === 0) {
    return {
      ok: false,
      reason: `pre-push base command budget exhausted before ${operation}`,
    };
  }
  const remainingMs = runtime.deadlineAt - runtime.now();
  if (remainingMs <= 0) {
    return {
      ok: false,
      reason: `pre-push base command deadline exceeded before ${operation}`,
    };
  }
  runtime.commandsRemaining -= 1;
  const timeout = Math.max(1, Math.floor(Math.min(runtime.commandTimeoutMs, remainingMs)));
  let result;
  try {
    result = runtime.runCommand(command, args, { timeout });
  } catch {
    return { ok: false, reason: `${operation} could not execute` };
  }
  if (result?.timedOut === true || result?.error?.code === 'ETIMEDOUT') {
    return { ok: false, reason: `${operation} timed out` };
  }
  if (!result || result.status !== 0) return { ok: false, reason: exitFailureReason };
  return { ok: true, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function fallbackRefExists(runtime, ref) {
  const result = runBaseCommand(
    runtime,
    'git',
    ['rev-parse', '--verify', `${ref}^{commit}`],
    'fallback base ref lookup',
    'fallback base ref did not exist',
  );
  if (result.ok) return true;
  if (result.reason === 'fallback base ref did not exist') return false;
  throw new Error(result.reason);
}

function resolveFallbackBase(runtime, options, explicitBaseRef = null) {
  if (options.resolveFallback) {
    return options.resolveFallback(explicitBaseRef, options.env ?? process.env);
  }
  return resolveBaseRef({
    explicitBaseRef,
    env: options.env ?? process.env,
    refExists: (ref) => fallbackRefExists(runtime, ref),
  });
}

function refused(refusalReason, fallbackReason = null) {
  return { baseRef: null, source: 'refused', fallbackReason, refusalReason };
}

function fallback(runtime, options, fallbackReason) {
  try {
    return {
      baseRef: resolveFallbackBase(runtime, options),
      source: 'fallback',
      fallbackReason,
    };
  } catch (error) {
    return refused(error.message, fallbackReason);
  }
}

function lookupFailure(runtime, options, reason) {
  return { failure: fallback(runtime, options, reason) };
}

function lookupPullRequestCandidate(runtime, options, selected) {
  const query = runBaseCommand(
    runtime,
    'gh',
    [
      'pr',
      'list',
      '--state',
      'open',
      '--head',
      selected.branch,
      '--json',
      'baseRefName,baseRefOid,headRefName,state,isCrossRepository',
    ],
    'pull request lookup',
    'pull request lookup failed',
  );
  if (!query.ok) return lookupFailure(runtime, options, query.reason);

  const candidates = parseCandidates(query.stdout);
  if (!candidates)
    return lookupFailure(runtime, options, 'pull request lookup returned malformed JSON');
  if (candidates.length === 0)
    return lookupFailure(runtime, options, 'no open pull request matched the pushed branch');
  if (candidates.length !== 1)
    return lookupFailure(runtime, options, 'multiple open pull requests matched the pushed branch');

  const [candidate] = candidates;
  if (!isTrustedCandidate(candidate, selected.branch))
    return lookupFailure(runtime, options, 'pull request candidate identity was not trusted');
  return { candidate };
}

function validateCandidateBaseRef(runtime, options, candidate) {
  const fullBaseRef = `refs/heads/${candidate.baseRefName}`;
  const validRef = runBaseCommand(
    runtime,
    'git',
    ['check-ref-format', fullBaseRef],
    'pull request base ref validation',
    'pull request base ref name was invalid',
  );
  if (!validRef.ok) return lookupFailure(runtime, options, validRef.reason);
  return { fullBaseRef };
}

function ensureCandidateObject(runtime, options, candidate, fullBaseRef) {
  const objectExists = runBaseCommand(
    runtime,
    'git',
    ['cat-file', '-e', `${candidate.baseRefOid}^{commit}`],
    'pull request base object lookup',
    'pull request base object was unavailable',
  );
  if (!objectExists.ok) {
    if (objectExists.reason !== 'pull request base object was unavailable') {
      return lookupFailure(runtime, options, objectExists.reason);
    }
    const fetched = runBaseCommand(
      runtime,
      'git',
      ['fetch', '--no-tags', 'origin', fullBaseRef],
      'pull request base ref fetch',
      'pull request base ref fetch failed',
    );
    if (!fetched.ok) return lookupFailure(runtime, options, fetched.reason);

    const fetchedHead = runBaseCommand(
      runtime,
      'git',
      ['rev-parse', 'FETCH_HEAD^{commit}'],
      'fetched pull request base object lookup',
      'fetched pull request base object was unreadable',
    );
    if (!fetchedHead.ok) return lookupFailure(runtime, options, fetchedHead.reason);
    if (fetchedHead.stdout.trim() !== candidate.baseRefOid) {
      return lookupFailure(
        runtime,
        options,
        'fetched base OID did not match the pull request base OID',
      );
    }
  }
  return { failure: null };
}

function resolveCandidateBase(runtime, options, selected) {
  const lookup = lookupPullRequestCandidate(runtime, options, selected);
  if (lookup.failure) return lookup.failure;

  const refValidation = validateCandidateBaseRef(runtime, options, lookup.candidate);
  if (refValidation.failure) return refValidation.failure;

  const objectValidation = ensureCandidateObject(
    runtime,
    options,
    lookup.candidate,
    refValidation.fullBaseRef,
  );
  if (objectValidation.failure) return objectValidation.failure;

  return {
    baseRef: lookup.candidate.baseRefOid,
    source: 'pull-request',
    fallbackReason: null,
  };
}

function resolvedSubject(options) {
  const hookInputWellFormed = options.hookInputWellFormed ?? true;
  return options.pushSubject ?? resolvePrePushSubject({ ...options, hookInputWellFormed });
}

export function resolvePrePushBaseRef(options) {
  const selected = resolvedSubject(options);
  if (!selected.ok) return refused(selected.reason);
  const runtime = createCommandRuntime(options);
  if (selected.deleteOnly) return fallback(runtime, options, 'push deletes only remote refs');
  const remoteMismatch =
    options.hookInputProvided &&
    (options.pushRemoteName !== 'origin' ||
      !options.pushRemoteUrl ||
      !options.originUrl ||
      options.pushRemoteUrl.trim() !== options.originUrl.trim());
  if (remoteMismatch) {
    return refused('push remote did not match the origin repository used for pull request lookup');
  }
  const explicit =
    typeof options.explicitBaseRef === 'string' ? options.explicitBaseRef.trim() : '';
  if (explicit) {
    try {
      return {
        baseRef: resolveFallbackBase(runtime, options, explicit),
        source: 'explicit',
        fallbackReason: null,
      };
    } catch (error) {
      return refused(error.message);
    }
  }
  return resolveCandidateBase(runtime, options, selected);
}

export function createPrePushBasePlan({ baseRef, source, fallbackReason, refusalReason }) {
  if (source === 'refused') {
    throw new Error(`pre-push subject refused: ${refusalReason ?? 'unresolved push identity'}`);
  }
  return Object.freeze({
    baseRef,
    baseArgs: baseRef ? Object.freeze(['--base-ref', baseRef]) : Object.freeze([]),
    classificationBaseRef: baseRef,
    decisionBaseRef: baseRef,
    receiptBaseRef: baseRef,
    source,
    fallbackReason,
  });
}

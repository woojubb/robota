import { spawnSync } from 'node:child_process';

const COMMAND_TIMEOUT_MS = 10_000;
const TOTAL_TIMEOUT_MS = 15_000;
const COMMAND_BUDGET = 6;

function positiveInteger(value, fallbackValue) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallbackValue;
}

function defaultRun(command, args, { cwd, timeout }) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    error: result.error,
    signal: result.signal,
  };
}

/** Resolve a branch, tag or full OID, refusing unknown lookup outcomes and revision syntax. */
export function resolveWorkflowDispatchCommit(ref, options = {}) {
  if (typeof ref !== 'string' || ref.length === 0 || ref !== ref.trim()) {
    throw new Error('workflow dispatch ref must be a non-empty branch, tag, or full commit OID');
  }
  const run = options.runCommand ?? defaultRun;
  const invoke = (args) => {
    let result;
    try {
      result = run('git', args, {
        cwd: options.cwd,
        timeout: COMMAND_TIMEOUT_MS,
      });
    } catch {
      throw new Error(`workflow dispatch ref lookup could not execute for ${ref}`);
    }
    if (result?.error || result?.signal || result?.timedOut || !Number.isInteger(result?.status)) {
      throw new Error(`workflow dispatch ref lookup failed for ${ref}`);
    }
    return result;
  };
  const peel = (candidate) => {
    const result = invoke(['rev-parse', '--verify', '--end-of-options', `${candidate}^{commit}`]);
    if (result.status !== 0) throw new Error(`workflow dispatch commit is unavailable: ${ref}`);
    const oid = result.stdout?.trim();
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(oid ?? '')) {
      throw new Error(`workflow dispatch ref returned an invalid commit OID for ${ref}`);
    }
    return oid;
  };
  const namedCommit = (candidate) => {
    if (invoke(['check-ref-format', candidate]).status !== 0) {
      throw new Error(`invalid workflow dispatch ref name: ${ref}`);
    }
    const exists = invoke(['show-ref', '--verify', '--quiet', '--', candidate]);
    if (exists.status === 1) return undefined;
    if (exists.status !== 0) throw new Error(`workflow dispatch ref lookup failed for ${ref}`);
    return peel(candidate);
  };
  if (/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(ref)) {
    const oid = peel(ref);
    if (oid !== ref) throw new Error(`workflow dispatch commit is unavailable: ${ref}`);
    return oid;
  }
  if (ref.startsWith('refs/heads/')) {
    const oid = namedCommit(`refs/remotes/origin/${ref.slice('refs/heads/'.length)}`);
    if (oid) return oid;
    throw new Error(`workflow dispatch branch is unavailable: ${ref}`);
  }
  if (ref.startsWith('refs/tags/')) {
    const oid = namedCommit(ref);
    if (oid) return oid;
    throw new Error(`workflow dispatch tag is unavailable: ${ref}`);
  }
  if (ref.startsWith('refs/')) throw new Error(`unsupported workflow dispatch ref: ${ref}`);
  const branch = namedCommit(`refs/remotes/origin/${ref}`);
  const tag = namedCommit(`refs/tags/${ref}`);
  if (branch && tag) throw new Error(`ambiguous workflow dispatch branch/tag: ${ref}`);
  if (branch || tag) return branch ?? tag;
  throw new Error(`workflow dispatch ref is unavailable: ${ref}`);
}

export function resolveWorkflowDispatchCommitPair({ baseRef, headRef, ...options }) {
  return {
    baseOid: resolveWorkflowDispatchCommit(baseRef, options),
    headOid: resolveWorkflowDispatchCommit(headRef, options),
  };
}

export function createBoundedGitRefExists(options = {}) {
  const now = options.now ?? Date.now;
  const runtime = {
    remaining: positiveInteger(options.commandBudget, COMMAND_BUDGET),
    deadline: now() + positiveInteger(options.totalCommandTimeoutMs, TOTAL_TIMEOUT_MS),
  };
  return (ref) => {
    if (runtime.remaining < 1)
      throw new Error(`git base ref command budget exhausted before ${ref} lookup`);
    const remainingMs = runtime.deadline - now();
    if (remainingMs < 1)
      throw new Error(`git base ref command deadline exceeded before ${ref} lookup`);
    runtime.remaining -= 1;
    let result;
    try {
      result = (options.runCommand ?? defaultRun)(
        'git',
        ['rev-parse', '--verify', `${ref}^{commit}`],
        {
          cwd: options.cwd,
          timeout: Math.max(
            1,
            Math.min(positiveInteger(options.commandTimeoutMs, COMMAND_TIMEOUT_MS), remainingMs),
          ),
        },
      );
    } catch {
      throw new Error(`git base ref lookup could not execute for ${ref}`);
    }
    if (result?.error?.code === 'ETIMEDOUT' || result?.timedOut === true) {
      throw new Error(`git base ref lookup timed out for ${ref}`);
    }
    if (!Number.isInteger(result?.status)) {
      throw new Error(`git base ref lookup returned no status for ${ref}`);
    }
    return result.status === 0;
  };
}

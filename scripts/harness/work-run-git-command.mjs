import { execFileSync } from 'node:child_process';

const MAX_BUFFER = 8 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 10_000;
const TOTAL_TIMEOUT_MS = 15_000;
const COMMAND_BUDGET = 32;

function positiveInteger(value, fallbackValue) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallbackValue;
}

export function createGitCommandRuntime(options = {}) {
  const now = options.now ?? Date.now;
  return {
    commandTimeoutMs: positiveInteger(options.commandTimeoutMs, COMMAND_TIMEOUT_MS),
    commandsRemaining: positiveInteger(options.commandBudget, COMMAND_BUDGET),
    deadlineAt: now() + positiveInteger(options.totalCommandTimeoutMs, TOTAL_TIMEOUT_MS),
    now,
  };
}

export function sharedGitOptions(options) {
  return {
    run: options.run,
    runtime: options.runtime ?? createGitCommandRuntime(options),
  };
}

export function commandTimeout(runtime, operation, requestedTimeout, label = 'git command') {
  if (!runtime) return positiveInteger(requestedTimeout, COMMAND_TIMEOUT_MS);
  if (runtime.commandsRemaining === 0)
    throw new Error(`${label} budget exhausted before ${operation}`);
  const remainingMs = runtime.deadlineAt - runtime.now();
  if (remainingMs <= 0) throw new Error(`${label} deadline exceeded before ${operation}`);
  runtime.commandsRemaining -= 1;
  return Math.max(
    1,
    Math.floor(
      Math.min(runtime.commandTimeoutMs, remainingMs, requestedTimeout ?? Number.MAX_SAFE_INTEGER),
    ),
  );
}

function executeGit(root, args, options, encoding) {
  const { run = execFileSync, runtime = null, timeout: requestedTimeout, ...execOptions } = options;
  const operation = args[0] ?? 'unknown operation';
  const timeout = commandTimeout(runtime, operation, requestedTimeout);
  try {
    return run('git', args, {
      cwd: root,
      maxBuffer: MAX_BUFFER,
      ...execOptions,
      encoding,
      timeout,
    });
  } catch (error) {
    if (error?.code === 'ETIMEDOUT' || error?.cause?.code === 'ETIMEDOUT') {
      throw new Error(`git command timed out during ${operation}`, { cause: error });
    }
    throw error;
  }
}

export function git(root, args, options = {}) {
  return executeGit(root, args, options, 'utf8').trim();
}

export function gitBytes(root, args, options = {}) {
  return executeGit(root, args, options, 'buffer');
}

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
  return { status: result.status ?? 1, error: result.error };
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

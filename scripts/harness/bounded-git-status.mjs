import { spawnSync } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_BUFFER = 8 * 1024 * 1024;

export function boundedGitStatus(root, options = {}) {
  const run = options.run ?? spawnSync;
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const result = run('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    timeout,
  });
  if (result.error?.code === 'ETIMEDOUT') {
    throw new Error(`git status timed out after ${timeout}ms`, { cause: result.error });
  }
  if (result.error) {
    throw new Error(`git status failed: ${result.error.message}`, { cause: result.error });
  }
  if (result.status !== 0) {
    throw new Error(`git status failed: ${result.stderr?.trim() || `exit ${result.status}`}`);
  }
  if (typeof result.stdout !== 'string') {
    throw new Error('git status failed: stdout was not text');
  }
  return result.stdout;
}

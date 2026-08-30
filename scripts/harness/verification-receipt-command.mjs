import { spawnSync } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

export function runVerificationCommand(
  command,
  args,
  root,
  { timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      LANG: 'C',
      LC_ALL: 'C',
    },
    maxBuffer: MAX_OUTPUT_BYTES,
    timeout: timeoutMs,
  });
  if (result.error?.code === 'ETIMEDOUT' || result.signal) {
    throw new Error(`${command} ${args.join(' ')} timed out after ${timeoutMs}ms`);
  }
  if (result.error) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr?.trim()}`);
  }
  return result.stdout.trim();
}

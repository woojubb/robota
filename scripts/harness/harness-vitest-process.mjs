import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { canonicalTemporaryDirectory } from './canonical-temporary-directory.mjs';
import { envWithoutGitVars } from './shared.mjs';

export const DEFAULT_CONTRACT_SHARD_TIMEOUT_MS = 240_000;
export const DEFAULT_CONTRACT_SHARD_KILL_GRACE_MS = 5_000;

export function contractShardTimeoutMs(environment = process.env) {
  const configured = Number(environment.HARNESS_CONTRACT_SHARD_TIMEOUT_MS);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_CONTRACT_SHARD_TIMEOUT_MS;
}

/** Keep fixture git commands rooted at their explicit cwd, including from a git hook. */
export function harnessTestEnvironment(
  base = process.env,
  tempRoot = canonicalTemporaryDirectory(),
) {
  return {
    ...envWithoutGitVars(base),
    TMPDIR: tempRoot,
    TMP: tempRoot,
    TEMP: tempRoot,
    ROBOTA_DISABLE_LESSONS_DIGEST: '1',
  };
}

function validateVitestRoot(root) {
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const vitestPackage = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
  return existsSync(vitestPackage) && packageJson.type === 'module' ? vitestPackage : undefined;
}

function unavailableVitest() {
  return {
    status: 1,
    stdout: '',
    stderr: 'installed Vitest and an ESM package root are required to run harness tests',
  };
}

function vitestArguments(root, files, config = undefined) {
  return [
    path.join(root, 'node_modules', 'vitest', 'vitest.mjs'),
    'run',
    ...files,
    ...(config ? ['--config', config] : []),
    // The complete harness contract fallback performs many repository-isolated fixture runs.
    // A single worker keeps the task-update channel responsive under that load and avoids
    // concurrent fixture processes competing for the same host resources.
    '--pool=threads',
    '--maxWorkers=1',
    '--testTimeout=30000',
    '--reporter=dot',
  ];
}

export function vitestInvocation(root, files, cwd = root, config = undefined) {
  if (!validateVitestRoot(root)) return unavailableVitest();
  const suiteTempRoot = mkdtempSync(
    path.join(canonicalTemporaryDirectory(), 'robota-harness-suite-'),
  );
  try {
    return spawnSync(process.execPath, vitestArguments(root, files, config), {
      cwd,
      encoding: 'utf8',
      env: harnessTestEnvironment(process.env, suiteTempRoot),
    });
  } finally {
    rmSync(suiteTempRoot, { recursive: true, force: true });
  }
}

/** Forward parent cancellation to every active async shard without leaking listeners. */
export function createActiveShardChildRegistry(parentProcess = process) {
  const active = new Map();
  const forward = (signal) => {
    for (const [child, state] of active) {
      state.cancellationSignal ??= signal;
      try {
        child.kill(signal);
      } catch {
        // A concurrent close may win; its non-success result remains authoritative.
      }
    }
  };
  const handlers = new Map(['SIGINT', 'SIGTERM'].map((signal) => [signal, () => forward(signal)]));
  const attach = () => {
    for (const [signal, handler] of handlers) parentProcess.on(signal, handler);
  };
  const detach = () => {
    for (const [signal, handler] of handlers) parentProcess.off(signal, handler);
  };
  return {
    register(child) {
      const state = { cancellationSignal: null };
      if (active.size === 0) attach();
      active.set(child, state);
      let released = false;
      return {
        get cancellationSignal() {
          return state.cancellationSignal;
        },
        release() {
          if (released) return;
          released = true;
          active.delete(child);
          if (active.size === 0) detach();
        },
      };
    },
    forward,
    get size() {
      return active.size;
    },
  };
}

const ACTIVE_SHARD_CHILDREN = createActiveShardChildRegistry();

/** Async Vitest process used only by the four-way complete affected fallback. */
export function vitestInvocationAsync(
  root,
  files,
  {
    spawnChild = spawn,
    childRegistry = ACTIVE_SHARD_CHILDREN,
    timeoutMs = contractShardTimeoutMs(),
    killGraceMs = DEFAULT_CONTRACT_SHARD_KILL_GRACE_MS,
    schedule = setTimeout,
    cancelSchedule = clearTimeout,
  } = {},
) {
  if (!validateVitestRoot(root)) return Promise.resolve(unavailableVitest());
  const suiteTempRoot = mkdtempSync(
    path.join(canonicalTemporaryDirectory(), 'robota-harness-suite-'),
  );
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnChild(process.execPath, vitestArguments(root, files), {
        cwd: root,
        env: harnessTestEnvironment(process.env, suiteTempRoot),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      rmSync(suiteTempRoot, { recursive: true, force: true });
      resolve({ status: 1, stdout: '', stderr: '', signal: null, timedOut: false, error });
      return;
    }
    const registration = childRegistry.register(child);
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let deadlineTimer;
    let killTimer;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const onStdout = (chunk) => (stdout += chunk);
    const onStderr = (chunk) => (stderr += chunk);
    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (deadlineTimer !== undefined) cancelSchedule(deadlineTimer);
      if (killTimer !== undefined) cancelSchedule(killTimer);
      child.off('error', onError);
      child.off('close', onClose);
      child.stdout.off('data', onStdout);
      child.stderr.off('data', onStderr);
      const cancellationSignal = registration.cancellationSignal;
      registration.release();
      rmSync(suiteTempRoot, { recursive: true, force: true });
      const signal = result.signal ?? cancellationSignal ?? null;
      resolve({
        stdout,
        stderr,
        ...result,
        status: signal || timedOut ? 1 : result.status,
        signal,
        timedOut,
        termination: timedOut ? 'timeout' : signal ? 'signal' : 'exit',
      });
    };
    const onError = (error) => finish({ status: 1, error });
    const onClose = (code, signal) => {
      if (signal) stderr += `\nVitest shard terminated by signal ${signal}.\n`;
      finish({ status: code ?? 1, signal });
    };
    child.once('error', onError);
    child.once('close', onClose);
    deadlineTimer = schedule(() => {
      if (settled) return;
      timedOut = true;
      stderr += `\nVitest shard exceeded process deadline (${timeoutMs}ms); sending SIGTERM.\n`;
      try {
        child.kill('SIGTERM');
      } catch {
        // The close/error event owns final cleanup and reporting.
      }
      if (settled) return;
      killTimer = schedule(() => {
        if (settled) return;
        stderr += `Vitest shard ignored SIGTERM for ${killGraceMs}ms; sending SIGKILL.\n`;
        try {
          child.kill('SIGKILL');
        } catch {
          // Keep temporary state until close/error confirms child termination.
        }
      }, killGraceMs);
    }, timeoutMs);
  });
}

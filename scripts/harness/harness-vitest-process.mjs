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

function vitestArguments(
  root,
  files,
  config = undefined,
  { pool = 'threads', maxWorkers = 2 } = {},
) {
  const poolArgument = pool === 'threads' ? '--pool=threads' : `--pool=${pool}`;
  const maxWorkersArgument = maxWorkers === 2 ? '--maxWorkers=2' : `--maxWorkers=${maxWorkers}`;
  return [
    path.join(root, 'node_modules', 'vitest', 'vitest.mjs'),
    'run',
    ...files,
    ...(config ? ['--config', config] : []),
    poolArgument,
    maxWorkersArgument,
    '--testTimeout=30000',
    '--reporter=dot',
  ];
}

export function vitestInvocation(
  root,
  files,
  cwd = root,
  config = undefined,
  execution = undefined,
) {
  if (!validateVitestRoot(root)) return unavailableVitest();
  const suiteTempRoot = mkdtempSync(
    path.join(canonicalTemporaryDirectory(), 'robota-harness-suite-'),
  );
  try {
    return spawnSync(process.execPath, vitestArguments(root, files, config, execution), {
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
  let cancellationSignal = null;
  const forward = (signal) => {
    cancellationSignal ??= signal;
    for (const [child, state] of active) {
      state.cancellationSignal ??= cancellationSignal;
      try {
        child.kill(cancellationSignal);
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
      const state = { cancellationSignal };
      if (active.size === 0 && cancellationSignal === null) attach();
      active.set(child, state);
      if (cancellationSignal !== null) {
        queueMicrotask(() => {
          try {
            child.kill(cancellationSignal);
          } catch {
            // The child may have closed before the cancellation microtask ran.
          }
        });
      }
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
    get cancellationSignal() {
      return cancellationSignal;
    },
    get cancelled() {
      return cancellationSignal !== null;
    },
    get size() {
      return active.size;
    },
  };
}

export const ACTIVE_SHARD_CHILDREN = createActiveShardChildRegistry();

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
    execution = undefined,
    onOutput = undefined,
  } = {},
) {
  if (!validateVitestRoot(root)) return Promise.resolve(unavailableVitest());
  const suiteTempRoot = mkdtempSync(
    path.join(canonicalTemporaryDirectory(), 'robota-harness-suite-'),
  );
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnChild(process.execPath, vitestArguments(root, files, undefined, execution), {
        cwd: root,
        env: harnessTestEnvironment(process.env, suiteTempRoot),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      rmSync(suiteTempRoot, { recursive: true, force: true });
      const stderr = `Vitest shard failed to start: ${error?.message ?? String(error)}\n`;
      let outputForwarded = false;
      if (typeof onOutput === 'function') {
        try {
          onOutput('stderr', stderr);
          outputForwarded = true;
        } catch {
          // The buffered stderr remains available to the completion reporter.
        }
      }
      resolve({ status: 1, stdout: '', stderr, signal: null, timedOut: false, error, outputForwarded });
      return;
    }
    const registration = childRegistry.register(child);
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let deadlineTimer;
    let killTimer;
    let forwardingFailed = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const forwardOutput = (stream, chunk) => {
      if (typeof onOutput !== 'function') return;
      try {
        onOutput(stream, chunk);
      } catch (error) {
        forwardingFailed = true;
        stderr += `\ncontract output forwarding failed: ${error?.message ?? String(error)}\n`;
      }
    };
    const appendStderr = (message) => {
      stderr += message;
      forwardOutput('stderr', message);
    };
    const onStdout = (chunk) => {
      stdout += chunk;
      forwardOutput('stdout', chunk);
    };
    const onStderr = (chunk) => {
      stderr += chunk;
      forwardOutput('stderr', chunk);
    };
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
        outputForwarded: typeof onOutput === 'function' && !forwardingFailed,
      });
    };
    const onError = (error) => {
      appendStderr(`Vitest shard process error: ${error?.message ?? String(error)}\n`);
      finish({ status: 1, error });
    };
    const onClose = (code, signal) => {
      if (signal) appendStderr(`\nVitest shard terminated by signal ${signal}.\n`);
      finish({ status: code ?? 1, signal });
    };
    child.once('error', onError);
    child.once('close', onClose);
    deadlineTimer = schedule(() => {
      if (settled) return;
      timedOut = true;
      appendStderr(`\nVitest shard exceeded process deadline (${timeoutMs}ms); sending SIGTERM.\n`);
      try {
        child.kill('SIGTERM');
      } catch {
        // The close/error event owns final cleanup and reporting.
      }
      if (settled) return;
      killTimer = schedule(() => {
        if (settled) return;
        appendStderr(`Vitest shard ignored SIGTERM for ${killGraceMs}ms; sending SIGKILL.\n`);
        try {
          child.kill('SIGKILL');
        } catch {
          // Keep temporary state until close/error confirms child termination.
        }
      }, killGraceMs);
    }, timeoutMs);
  });
}

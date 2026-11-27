import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

import { killProcessTree } from '@robota-sdk/agent-os/process';

import { boundedOption } from './bounded-option';
import { AcpParticipantError } from './errors';
import type { AcpConnection, AcpLauncher } from './launcher';

const DEFAULT_KILL_GRACE_MS = 2_000;
/** A stderr line longer than this is delivered in pieces, so one unterminated flood stays bounded. */
const MAX_STDERR_LINE_CHARS = 16_384;
/** How long to wait for a killed group to disappear from the process table. */
const KILL_SETTLE_MS = 2_000;

export interface SpawnAcpAgentOptions {
  /** The program to run: an absolute path, or a name found on the `PATH` of `env`. */
  command: string;
  args?: readonly string[];
  /** Absolute working directory of the agent process. */
  cwd: string;
  /**
   * The agent process's whole environment. Nothing is inherited from the host, so pass what the
   * agent needs to start and authenticate, such as `PATH`.
   */
  env: Readonly<Record<string, string>>;
  /**
   * How long, in milliseconds, `close()` waits after asking the process tree to exit before it
   * kills the tree. Defaults to 2000.
   */
  killGraceMs?: number;
  /**
   * Receives the agent's standard error one line at a time. The stream is always drained, with or
   * without a listener, so a chatty agent can never block on a full pipe.
   */
  onStderr?: (line: string) => void;
}

function validate(options: SpawnAcpAgentOptions): { args: string[]; killGraceMs: number } {
  const killGraceMs = boundedOption('killGraceMs', options.killGraceMs, DEFAULT_KILL_GRACE_MS);
  if (typeof options.command !== 'string' || options.command === '') {
    throw new AcpParticipantError('invalid-options', 'command must be a non-empty string');
  }
  const args = [...(options.args ?? [])];
  if (args.some((arg) => typeof arg !== 'string')) {
    throw new AcpParticipantError('invalid-options', 'args must all be strings');
  }
  if (typeof options.cwd !== 'string' || !isAbsolute(options.cwd)) {
    throw new AcpParticipantError('invalid-options', 'cwd must be an absolute path');
  }
  const env: unknown = options.env;
  if (
    typeof env !== 'object' ||
    env === null ||
    Array.isArray(env) ||
    Object.values(env).some((value) => typeof value !== 'string')
  ) {
    throw new AcpParticipantError(
      'invalid-options',
      'env is required and must map names to string values',
    );
  }
  return { args, killGraceMs };
}

/** Delivers a byte stream line by line; never throws and never holds more than one bounded line. */
function drainLines(stream: Readable, onLine: ((line: string) => void) | undefined): void {
  if (onLine === undefined) {
    stream.resume();
    return;
  }
  const decoder = new StringDecoder('utf8');
  let pending = '';
  const emit = (line: string): void => {
    try {
      onLine(line.endsWith('\r') ? line.slice(0, -1) : line);
    } catch {
      // allow-fallback: a throwing listener must not stop the drain, or the pipe could fill
    }
  };
  stream.on('data', (chunk: Buffer) => {
    pending += decoder.write(chunk);
    let newline = pending.indexOf('\n');
    while (newline >= 0) {
      emit(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
      newline = pending.indexOf('\n');
    }
    while (pending.length > MAX_STDERR_LINE_CHARS) {
      emit(pending.slice(0, MAX_STDERR_LINE_CHARS));
      pending = pending.slice(MAX_STDERR_LINE_CHARS);
    }
  });
  stream.on('end', () => {
    pending += decoder.end();
    if (pending !== '') emit(pending);
    pending = '';
  });
  // A stream error ends the stream; there is nothing left to drain.
  stream.on('error', () => {});
}

/** Whether any process of the group is left. A live group's id cannot belong to anything else. */
function groupExists(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function signalGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch {
    // allow-fallback: the group emptied between the check and the signal, which is the goal
  }
}

/** Resolves once `done()` holds or `ms` have passed, checking on a short interval. */
function waitUntil(done: () => boolean, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const deadline = Date.now() + ms;
    const check = (): void => {
      if (done() || Date.now() >= deadline) resolve();
      else setTimeout(check, 10);
    };
    check();
  });
}

/**
 * Ends whatever of the agent's process group is left after its leader is gone or has been asked to
 * exit: a helper outlives its parent, or ignores the request. Asks the group to exit, waits up to
 * `graceMs`, then kills it. Where there are no process groups, the tree kill alone applies.
 */
async function endRemainingGroup(pid: number | undefined, graceMs: number): Promise<void> {
  if (process.platform === 'win32' || pid === undefined || !groupExists(pid)) return;
  signalGroup(pid, 'SIGTERM');
  await waitUntil(() => !groupExists(pid), graceMs);
  if (!groupExists(pid)) return;
  signalGroup(pid, 'SIGKILL');
  await waitUntil(() => !groupExists(pid), KILL_SETTLE_MS);
}

function started(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
}

/**
 * A launcher that starts the agent as a child process and speaks to it over its standard input and
 * output. Each `launch()` starts one process, in its own process group on POSIX so that closing the
 * connection ends the whole tree the agent started, not only the agent.
 *
 * The agent gets exactly the `env` it is given. If the host itself crashes, an agent that does not
 * exit when its standard input ends keeps running: nothing here supervises beyond the tree it
 * started.
 */
export function spawnAcpAgent(options: SpawnAcpAgentOptions): AcpLauncher {
  const { args, killGraceMs } = validate(options);
  const { command, cwd, onStderr } = options;
  const env = { ...options.env };

  return {
    async launch(): Promise<AcpConnection> {
      const child = spawn(command, args, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
      try {
        await started(child);
      } catch (error) {
        throw new AcpParticipantError(
          'launch-failed',
          `The agent could not be started (${command}): ${
            error instanceof Error ? error.message : String(error)
          }`,
          { cause: error },
        );
      }
      // Errors after the start (a failed signal, a broken pipe) surface through the streams ending.
      child.on('error', () => {});
      child.stdin.on('error', () => {});
      drainLines(child.stderr, onStderr);

      // When the agent exits, whatever it left behind goes too: a helper holding its standard output
      // would otherwise keep the connection open for good. The output is not cut short; once the
      // holders are gone it ends by itself, after everything the agent wrote has been read.
      let remaining: Promise<void> | undefined;
      const endRemaining = (): Promise<void> =>
        (remaining ??= endRemainingGroup(child.pid, killGraceMs));
      child.once('exit', () => void endRemaining());

      let closing: Promise<void> | undefined;
      return {
        toAgent: Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>,
        fromAgent: Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
        close: () =>
          (closing ??= (async () => {
            child.stdin.end();
            await killProcessTree(child, { graceMs: killGraceMs, processGroup: true });
            // The tree kill stops at the leader: helpers that outlived it or ignored the request
            // are ended here.
            await endRemaining();
          })()),
      };
    },
  };
}

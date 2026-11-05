/**
 * Whether the children this process starts share its controlling terminal: one decision for the
 * whole process, made once by its entry, and read at every spawn (decided design change 4 of #3679).
 *
 * ## Why a child leaves the session
 *
 * A child in the terminal's session can open `/dev/tty` and, through `TIOCSTI`, type into it as the
 * owner — including while a passphrase is being typed. In its own session (`setsid`, which Node's
 * `detached` does on POSIX) it has no controlling terminal, so neither works. Holding the terminal
 * as an inherited descriptor would undo that, so while the policy is on a caller may not hand a child
 * one. Node's defaults hand none — a sync spawn pipes stderr and copies it to this process's stderr
 * afterwards — so a stream left to the default stays as it is. Reading the terminal device by its
 * path stays possible for any same-user program; that residual is the design's, not something a spawn
 * option can close.
 *
 * ## Why process-wide
 *
 * The controlling terminal belongs to the process, not to a session, a store or a tool; and this
 * package's own hook executor and identity readers spawn, while it may depend on nothing. Threading
 * an option through every constructor instead would leave each default sharing the terminal. The
 * decision lives on `globalThis` so two loaded copies of this module agree, and it only ever turns on:
 * a process that started secure keeps its children out of its terminal until it ends.
 *
 * ## Exempt: the terminal handover
 *
 * `/editor`, `/keybindings`, `/shell` and the workspace-move re-exec hand the terminal to the child
 * while the interface has given it up. They do not call this module.
 *
 * ## Ending the children
 *
 * Detached children no longer get the terminal's hangup, so a caller that starts one this process
 * should end registers it with {@link endWithProcess}: its group is killed with this process (see
 * `process-exit-removals.ts`), and {@link signalChildGroup} reaches the whole group. Both hold only
 * while the leader lives. Once it is reaped its pid, and so the group's id, may belong to an unrelated
 * process, so nothing is signalled or kept registered then, and a descendant that outlives its leader
 * is left alone. A program this process kills by its leader alone would leave the rest of the group
 * behind.
 *
 * ## Windows
 *
 * The policy stays off. A Windows console is not a session a child can leave: any same-user process
 * can attach to it, and `detached` there opens a new console window and cuts console control events.
 *
 * ## execFile
 *
 * `execFile` forwards only a fixed set of options to `spawn`, and `detached` is not among them. So
 * {@link execFileInChildSession} runs `execFile` itself while the policy is off — plain spawning is
 * unchanged — and while on, mirrors it over `spawn`, step for step: a timeout, an overflow or a kill
 * destroys the pipes and signals, and the call settles when the child closes or errors; an abort
 * signals with SIGTERM whatever `killSignal` says and settles at once with its error, once, and only
 * while the leader lives; an abort that is already in force calls back on the next tick, never before
 * the call returns. The one difference is the group: the signal reaches it, not only the leader, and
 * its registration with the process-end registry is released when the leader exits, not when the call
 * settles, so a program that ignores the signal is still ended with this process.
 */

import { execFile, spawn } from 'node:child_process';

import { endProcessGroupOnProcessExit } from './process-exit-removals.js';

import type { ChildProcess, ExecFileException, ExecFileOptions } from 'node:child_process';

const POLICY = Symbol.for('@robota-sdk/agent-core:child-sessions@1');
const SPAWN_HOLDS = Symbol.for('@robota-sdk/agent-core:spawn-holds@1');
/** `execFile`'s own default, kept so a caller sees the same bound either way. */
const EXEC_FILE_MAX_BUFFER = 1024 * 1024;

interface IChildSessionPolicy {
  own: boolean;
  /** Children whose group this process ends, each with the cancel for its registration. */
  readonly tracked: Map<ChildProcess, () => void>;
}

type TPolicyHolder = { [POLICY]?: IChildSessionPolicy };

function policy(): IChildSessionPolicy {
  const holder = globalThis as TPolicyHolder;
  holder[POLICY] ??= { own: false, tracked: new Map() };
  return holder[POLICY];
}

export interface IEnableOwnChildSessionsOptions {
  /** The platform deciding; this process's own by default. */
  readonly platform?: NodeJS.Platform;
}

/**
 * From now on, every child this process starts through {@link withChildSession} leads its own
 * session. One-way, and a no-op on Windows.
 */
export function enableOwnChildSessions(options: IEnableOwnChildSessionsOptions = {}): void {
  if ((options.platform ?? process.platform) === 'win32') return;
  policy().own = true;
}

function spawnHolds(): Set<object> {
  const holder = globalThis as { [SPAWN_HOLDS]?: Set<object> };
  holder[SPAWN_HOLDS] ??= new Set();
  return holder[SPAWN_HOLDS];
}

/** Hold child-session spawn paths while a handed-over descriptor is being consumed. */
export function holdChildSpawns(): () => void {
  const holds = spawnHolds();
  const hold = {};
  holds.add(hold);
  return () => { holds.delete(hold); };
}

function assertChildSpawnsAllowed(): void {
  if (spawnHolds().size > 0) {
    throw new Error('Cannot spawn a child while a handover descriptor is open.');
  }
}

/** A stdio entry that would hand the child this process's terminal. */
function inheritsTerminal(entry: unknown): boolean {
  return (
    entry === 'inherit' ||
    entry === 0 ||
    entry === 1 ||
    entry === 2 ||
    entry === process.stdin ||
    entry === process.stdout ||
    entry === process.stderr
  );
}

/**
 * `T` with its arrays writable again. The options are inferred `const`, so `spawn` still sees a stdio
 * tuple and picks the overload with non-null streams, but `spawn` takes no readonly tuple.
 */
export type TChildSessionOptions<T> = {
  -readonly [K in keyof T]: T[K] extends readonly unknown[]
    ? { -readonly [I in keyof T[K]]: T[K][I] }
    : T[K];
};

/**
 * The spawn options for a child that is not a terminal-handover child. While the policy is off it
 * returns `options` itself. While on, the copy also leads its own session, and an entry that would
 * hand the child this process's terminal is refused.
 */
export function withChildSession<const T extends object>(options: T): TChildSessionOptions<T> {
  assertChildSpawnsAllowed();
  if (!policy().own) return options as TChildSessionOptions<T>;
  const stdio = (options as { readonly stdio?: unknown }).stdio;
  const entries: readonly unknown[] = Array.isArray(stdio) ? stdio : [stdio];
  if (entries.some(inheritsTerminal)) {
    throw new Error(
      'A child in its own session may not inherit this process’s terminal; only the terminal handover may hand it over.',
    );
  }
  return { ...options, detached: true } as TChildSessionOptions<T>;
}

/**
 * End `child`'s process group when this process ends, until the child itself exits. Returns `child`.
 * Does nothing while the policy is off, when the child shares this process's group and session.
 */
export function endWithProcess<T extends ChildProcess>(child: T): T {
  const state = policy();
  if (!state.own || child.pid === undefined) return child;
  const cancel = endProcessGroupOnProcessExit(child.pid);
  state.tracked.set(child, cancel);
  child.once('exit', () => {
    state.tracked.delete(child);
    cancel();
  });
  return child;
}

/**
 * Signal `child`: its whole group while {@link endWithProcess} tracks it, which is while its leader
 * lives, otherwise the child alone, exactly as `child.kill(signal)`, which signals nothing once the
 * child has exited. Returns whether a signal was sent, as `child.kill` does.
 */
export function signalChildGroup(child: ChildProcess, signal: NodeJS.Signals): boolean {
  if (policy().tracked.has(child) && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      // `child.kill` sets this when it delivers a signal; a signal sent to the group is the same fact.
      (child as { killed: boolean }).killed = true;
      return true;
    } catch {
      // allow-fallback: the group ended between the check and the signal; the leader may remain.
    }
  }
  return child.kill(signal);
}

/** The `execFile` options {@link execFileInChildSession} accepts; output is always text. */
export interface IExecFileInChildSessionOptions extends ExecFileOptions {
  readonly encoding?: BufferEncoding;
  readonly maxBuffer?: number;
  readonly killSignal?: NodeJS.Signals;
}

export type TExecFileCallback = (
  error: ExecFileException | null,
  stdout: string,
  stderr: string,
) => void;

/**
 * `execFile(file, args, options, callback)` for a child that is not a terminal-handover child. While
 * the policy is off it is `execFile` itself. While on, the same call runs over `spawn` in the child's
 * own session (see the header), signalling the child's whole group while its leader lives.
 */
export function execFileInChildSession(
  file: string,
  args: readonly string[],
  options: IExecFileInChildSessionOptions,
  callback: TExecFileCallback,
): ChildProcess {
  assertChildSpawnsAllowed();
  if (!policy().own) {
    return execFile(file, [...args], options, (error, stdout, stderr) =>
      callback(error, String(stdout), String(stderr)),
    );
  }
  return execFileOverSpawn(file, args, options, callback);
}

/** The error a failed `execFile` reports, as Node builds it. */
function commandFailed(
  command: string,
  stderr: string,
  fields: { code?: number | null; killed: boolean; signal?: NodeJS.Signals | null },
): ExecFileException {
  return Object.assign(new Error(`Command failed: ${command}\n${stderr}`), fields, {
    cmd: command,
  }) as unknown as ExecFileException;
}

/** What Node's spawn reports when its `signal` aborts a running child. */
function abortError(cause: unknown): Error {
  return Object.assign(new Error('The operation was aborted', { cause }), {
    name: 'AbortError',
    code: 'ABORT_ERR',
  });
}

/**
 * Node's `execFile` over `spawn`, kept line for line (lib/child_process.js) so the two cannot drift:
 * what differs is only that the child leads its own group, which {@link signalChildGroup} signals
 * while the leader lives, and that the group's registration lasts until that leader exits.
 */
function execFileOverSpawn(
  file: string,
  args: readonly string[],
  options: IExecFileInChildSessionOptions,
  callback: TExecFileCallback,
): ChildProcess {
  const encoding = options.encoding ?? 'utf8';
  const maxBuffer = options.maxBuffer ?? EXEC_FILE_MAX_BUFFER;
  const killSignal = options.killSignal ?? 'SIGTERM';
  const child = endWithProcess(
    spawn(
      file,
      [...args],
      withChildSession({
        cwd: options.cwd,
        env: options.env,
        uid: options.uid,
        gid: options.gid,
        shell: options.shell,
        windowsHide: options.windowsHide,
        windowsVerbatimArguments: options.windowsVerbatimArguments,
        stdio: 'pipe' as const,
      }),
    ),
  );
  const stdout: string[] = [];
  const stderr: string[] = [];
  let killed = false;
  let exited = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let failure: ExecFileException | null = null;
  let command = file;

  const exitHandler = (code?: number | null, signal?: NodeJS.Signals | null): void => {
    if (exited) return;
    exited = true;
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    const out = stdout.join('');
    const err = stderr.join('');
    if (failure === null && code === 0 && signal === null) {
      callback(null, out, err);
      return;
    }
    if (args.length > 0) command += ` ${args.join(' ')}`;
    failure ??= commandFailed(command, err, { code, killed: child.killed || killed, signal });
    failure.cmd = command;
    callback(failure, out, err);
  };
  const errorHandler = (error: ExecFileException): void => {
    failure = error;
    child.stdout?.destroy();
    child.stderr?.destroy();
    exitHandler();
  };
  const kill = (): void => {
    child.stdout?.destroy();
    child.stderr?.destroy();
    killed = true;
    try {
      signalChildGroup(child, killSignal);
    } catch (error) {
      failure = error as ExecFileException;
      exitHandler();
    }
  };

  if (options.timeout !== undefined && options.timeout > 0) {
    timeoutId = setTimeout(() => {
      kill();
      timeoutId = undefined;
    }, options.timeout);
  }

  const collectOutput = (
    stream: NodeJS.ReadableStream | null,
    parts: string[],
    label: 'stdout' | 'stderr',
  ): void => {
    if (stream === null) return;
    (stream as NodeJS.ReadStream).setEncoding(encoding);
    let length = 0;
    stream.on('data', (chunk: string) => {
      if (maxBuffer === Infinity) {
        parts.push(chunk);
        return;
      }
      const size = Buffer.byteLength(chunk, encoding);
      length += size;
      if (length > maxBuffer) {
        // What fits is kept, as `execFile` keeps it.
        parts.push(chunk.slice(0, maxBuffer - (length - size)));
        failure = Object.assign(new RangeError(`${label} maxBuffer length exceeded`), {
          code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
        }) as unknown as ExecFileException;
        kill();
      } else {
        parts.push(chunk);
      }
    });
  };
  collectOutput(child.stdout, stdout, 'stdout');
  collectOutput(child.stderr, stderr, 'stderr');
  child.addListener('close', exitHandler);
  child.addListener('error', errorHandler);

  // Node's spawn handles `signal`, not execFile: SIGTERM whatever `killSignal` says, an error only if
  // a signal went out (so not once the leader has exited), and on the next tick if already aborted.
  const signal = options.signal;
  if (signal !== undefined) {
    const onAbort = (): void => {
      try {
        if (signalChildGroup(child, 'SIGTERM')) child.emit('error', abortError(signal.reason));
      } catch (error) {
        child.emit('error', error);
      }
    };
    if (signal.aborted) {
      process.nextTick(onAbort);
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
      child.once('exit', () => signal.removeEventListener('abort', onAbort));
    }
  }
  return child;
}

/** Back to the process's starting state: off, nothing tracked. For tests in one process only. */
export function resetChildSessionPolicy(): void {
  const state = policy();
  for (const cancel of state.tracked.values()) cancel();
  state.tracked.clear();
  spawnHolds().clear();
  state.own = false;
}

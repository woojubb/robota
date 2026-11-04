/**
 * Whether the children this process starts share its controlling terminal: one decision for the
 * whole process, made once by its entry, and read at every spawn (decided design change 4 of #3679).
 *
 * ## Why a child leaves the session
 *
 * A child in the terminal's session can open `/dev/tty` and, through `TIOCSTI`, type into it as the
 * owner — including while a passphrase is being typed. In its own session (`setsid`, which Node's
 * `detached` does on POSIX) it has no controlling terminal, so neither works. Holding the terminal
 * as an inherited descriptor would undo that, so while the policy is on a child may not inherit one,
 * and a stream left to the default is piped (for a sync spawn the default stderr is the terminal).
 * Reading the terminal device by its path stays possible for any same-user program; that residual is
 * the design's, not something a spawn option can close.
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
 * `process-exit-removals.ts`), and {@link signalChildGroup} reaches the whole group while its leader
 * lives. A program this process kills by its leader alone would leave the rest of the group behind.
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
 * unchanged — and while on, runs the same contract over `spawn`: a timeout, an overflow or an abort
 * lets go of the pipes and settles as `execFile` does, and ends the whole group, which is held until
 * the call settles because a descendant can outlive the program.
 */

import { execFile, spawn } from 'node:child_process';

import { endProcessGroupOnProcessExit } from './process-exit-removals.js';

import type { ChildProcess, ExecFileException, ExecFileOptions } from 'node:child_process';

const POLICY = Symbol.for('@robota-sdk/agent-core:child-sessions@1');
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
 * returns `options` itself. While on, the copy also leads its own session, pipes what the caller left
 * to the default, and an entry that would inherit this process's terminal is refused.
 */
export function withChildSession<const T extends object>(options: T): TChildSessionOptions<T> {
  if (!policy().own) return options as TChildSessionOptions<T>;
  const stdio = (options as { readonly stdio?: unknown }).stdio;
  const entries: readonly unknown[] = Array.isArray(stdio) ? stdio : [stdio];
  if (entries.some(inheritsTerminal)) {
    throw new Error(
      'A child in its own session may not inherit this process’s terminal; only the terminal handover may hand it over.',
    );
  }
  return { ...options, detached: true, stdio: stdio ?? 'pipe' } as TChildSessionOptions<T>;
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
 * Signal `child`: its whole group while {@link endWithProcess} tracks it, otherwise the child alone,
 * exactly as `child.kill(signal)`.
 */
export function signalChildGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (policy().tracked.has(child) && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // allow-fallback: the group ended between the check and the signal; the leader may remain.
    }
  }
  child.kill(signal);
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
 * the policy is off it is `execFile` itself. While on, the same contract runs over `spawn` in the
 * child's own session, and a timeout, an overflow or an abort ends the child's whole group.
 */
export function execFileInChildSession(
  file: string,
  args: readonly string[],
  options: IExecFileInChildSessionOptions,
  callback: TExecFileCallback,
): ChildProcess {
  if (!policy().own) {
    return execFile(file, [...args], options, (error, stdout, stderr) =>
      callback(error, String(stdout), String(stderr)),
    );
  }
  return execFileOverSpawn(file, args, options, callback);
}

function commandFailed(
  file: string,
  args: readonly string[],
  stderr: string,
  fields: Partial<ExecFileException>,
): ExecFileException {
  const command = [file, ...args].join(' ');
  return Object.assign(new Error(`Command failed: ${command}\n${stderr}`), fields, {
    cmd: command,
  }) as ExecFileException;
}

function abortError(cause: unknown): ExecFileException {
  return Object.assign(new Error('The operation was aborted', { cause }), {
    name: 'AbortError',
    code: 'ABORT_ERR',
  }) as ExecFileException;
}

function execFileOverSpawn(
  file: string,
  args: readonly string[],
  options: IExecFileInChildSessionOptions,
  callback: TExecFileCallback,
): ChildProcess {
  const encoding = options.encoding ?? 'utf8';
  const maxBuffer = options.maxBuffer ?? EXEC_FILE_MAX_BUFFER;
  const killSignal = options.killSignal ?? 'SIGTERM';
  const child = spawn(
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
  );
  // The leader's pid is the group's id. Unlike `endWithProcess`, the group is held until the call
  // settles rather than until the leader exits: a descendant the program left behind may still hold
  // its output, and a call that gives up must end it too.
  const group = child.pid;
  const releaseGroup =
    group === undefined ? (): void => undefined : endProcessGroupOnProcessExit(group);
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let killed = false;
  let failure: ExecFileException | undefined;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const kill = (): void => {
    killed = true;
    // As `execFile` does: let go of the pipes, so the call settles once the program has ended even
    // while a descendant still holds them.
    child.stdout?.destroy();
    child.stderr?.destroy();
    if (group !== undefined) {
      try {
        process.kill(-group, killSignal);
        return;
      } catch {
        // allow-fallback: the group has ended; only the leader can be left to signal.
      }
    }
    child.kill(killSignal);
  };
  const text = (parts: Buffer[]): string => Buffer.concat(parts).toString(encoding);
  // `execFile` settles an abort of a running program at once. An abort after the program has
  // exited does not fail the call there, which waits for the output to close; here the group is
  // ended, so a descendant holding the output goes too and the call settles as the program ended.
  const onAbort = (): void => {
    if (child.exitCode !== null || child.signalCode !== null) {
      if (group !== undefined) {
        try {
          process.kill(-group, killSignal);
        } catch {
          // allow-fallback: nothing of the group is left; the output is closing already.
        }
      }
      return;
    }
    failure ??= abortError(options.signal?.reason);
    kill();
    finish(failure);
  };
  const finish = (error: ExecFileException | null): void => {
    if (settled) return;
    settled = true;
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
    releaseGroup();
    callback(error, text(stdout), text(stderr));
  };
  const collect = (parts: Buffer[], stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
    const total =
      stream === 'stdout' ? (stdoutBytes += chunk.length) : (stderrBytes += chunk.length);
    if (total > maxBuffer) {
      failure ??= Object.assign(new RangeError(`${stream} maxBuffer length exceeded`), {
        code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
      }) as unknown as ExecFileException;
      kill();
      return;
    }
    parts.push(chunk);
  };

  child.stdout?.on('data', collect(stdout, 'stdout'));
  child.stderr?.on('data', collect(stderr, 'stderr'));
  child.once('error', (error: ExecFileException) => finish(failure ?? error));
  child.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
    if (failure !== undefined) return finish(failure);
    if (code === 0 && signal === null) return finish(null);
    finish(
      commandFailed(file, args, text(stderr), {
        code: code ?? undefined,
        killed,
        signal: signal ?? undefined,
      }),
    );
  });
  if (options.timeout !== undefined && options.timeout > 0)
    timer = setTimeout(kill, options.timeout);
  if (options.signal?.aborted === true) onAbort();
  else options.signal?.addEventListener('abort', onAbort, { once: true });
  return child;
}

/** Back to the process's starting state: off, nothing tracked. For tests in one process only. */
export function resetChildSessionPolicy(): void {
  const state = policy();
  for (const cancel of state.tracked.values()) cancel();
  state.tracked.clear();
  state.own = false;
}

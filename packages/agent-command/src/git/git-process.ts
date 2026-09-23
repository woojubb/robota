/**
 * BEHAVIOR-2437: the one seam every `/git` verb runs git through.
 *
 * argv only — `execFile` with `shell: false`, so no user token is ever parsed as shell syntax; stdin
 * is closed at once, so a hook that reads it sees EOF instead of hanging; output is capped, the child
 * is bounded by a timeout, and every way a run can end is a typed outcome rather than a throw. Exit
 * codes are DATA: `diff --cached --quiet` answers with 1, and that is an answer, not an error.
 */
import { execFile } from 'node:child_process';
import { constants } from 'node:os';

import type { ExecFileException } from 'node:child_process';

export const GIT_DEFAULT_TIMEOUT_MS = 120_000;
const BYTES_PER_KIB = 1024;
const OUTPUT_CAP_MIB = 16;
export const GIT_MAX_OUTPUT_BYTES = OUTPUT_CAP_MIB * BYTES_PER_KIB * BYTES_PER_KIB;
/** The shell convention for a signal-terminated child: 128 + the signal number. */
const SIGNAL_EXIT_BASE = 128;

/**
 * Variables that redirect a git child to ANOTHER repository. Git exports them into hooks, so a
 * `/git` run started from inside a hook (or from any process that inherited one) would otherwise
 * operate on the wrong tree. Identity and configuration variables are deliberately NOT here — the
 * user's `GIT_CONFIG_GLOBAL`, `GIT_AUTHOR_*`, `GPG_TTY`, `SSH_AUTH_SOCK` … are what make the commit
 * theirs.
 */
export const GIT_ENV_DENYLIST: readonly string[] = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_PREFIX',
  'GIT_NAMESPACE',
];

export interface IGitProcessRunOptions {
  cwd: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * `not-found` covers every spawn failure — ENOENT, EACCES, ENOTDIR, … — with the code in `detail`;
 * the other three are the run's own bounds.
 */
export type TGitProcessFailureReason = 'not-found' | 'timeout' | 'aborted' | 'output-too-large';

export type TGitProcessOutcome =
  | { kind: 'exited'; stdout: string; stderr: string; exitCode: number }
  | { kind: 'failed'; reason: TGitProcessFailureReason; detail: string };

export interface IGitProcessPort {
  run(args: readonly string[], options: IGitProcessRunOptions): Promise<TGitProcessOutcome>;
}

export interface ICreateGitProcessOptions {
  /** The executable to run; `git` on PATH by default. */
  executable?: string;
  /** The environment to derive the child's from; the live process environment by default. */
  env?: NodeJS.ProcessEnv;
}

/** The child's environment: `source` minus the repository-redirecting variables. */
export function gitEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (!GIT_ENV_DENYLIST.includes(key)) env[key] = value;
  }
  return env;
}

function failed(reason: TGitProcessFailureReason, detail: string): TGitProcessOutcome {
  return { kind: 'failed', reason, detail };
}

function signalNumber(signal: NodeJS.Signals): number {
  return constants.signals[signal] ?? 0;
}

function toOutcome(
  error: ExecFileException | null,
  stdout: string,
  stderr: string,
  context: { executable: string; timeoutMs: number; signal: AbortSignal | undefined },
): TGitProcessOutcome {
  if (error === null) return { kind: 'exited', stdout, stderr, exitCode: 0 };
  if (context.signal?.aborted === true || error.name === 'AbortError') {
    return failed('aborted', 'the run was aborted before git exited');
  }
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return failed(
      'output-too-large',
      `git produced more than ${OUTPUT_CAP_MIB} MiB of output and was stopped`,
    );
  }
  // Our own kill wins over whatever exit the child managed on the way down (a shell trap exiting
  // 143 is still a timeout).
  if (error.killed === true) {
    return failed('timeout', `git did not exit within ${context.timeoutMs} ms and was stopped`);
  }
  if (typeof error.code === 'number')
    return { kind: 'exited', stdout, stderr, exitCode: error.code };
  if (error.signal) {
    // RUNTIME-53 convention: a signal-terminated child reports 128 + the signal number.
    return {
      kind: 'exited',
      stdout,
      stderr,
      exitCode: SIGNAL_EXIT_BASE + signalNumber(error.signal),
    };
  }
  return failed(
    'not-found',
    `${context.executable} could not be run (${String(error.code ?? error.message)})`,
  );
}

/** The production port: argv-only `execFile`, stdin closed, output capped, timeout bounded. */
export function createGitProcess(options: ICreateGitProcessOptions = {}): IGitProcessPort {
  const executable = options.executable ?? 'git';
  return {
    run(args, runOptions) {
      const timeoutMs = runOptions.timeoutMs ?? GIT_DEFAULT_TIMEOUT_MS;
      const env = gitEnvironment(options.env ?? process.env);
      return new Promise<TGitProcessOutcome>((resolve) => {
        const child = execFile(
          executable,
          [...args],
          {
            cwd: runOptions.cwd,
            env,
            shell: false,
            encoding: 'utf8',
            timeout: timeoutMs,
            maxBuffer: GIT_MAX_OUTPUT_BYTES,
            windowsHide: true,
            ...(runOptions.signal ? { signal: runOptions.signal } : {}),
          },
          (error, stdout, stderr) =>
            resolve(
              toOutcome(error, stdout, stderr, {
                executable,
                timeoutMs,
                signal: runOptions.signal,
              }),
            ),
        );
        // stdin is a pipe by default; closing it at once turns a hook's read into EOF.
        child.stdin?.end();
      });
    },
  };
}

/**
 * The reason a run did not produce a usable answer, for the verbs where a non-zero exit IS a failure.
 * `undefined` when the child exited 0.
 */
export function gitFailureMessage(verb: string, outcome: TGitProcessOutcome): string | undefined {
  if (outcome.kind === 'failed') return `git ${verb} failed: ${outcome.detail}`;
  if (outcome.exitCode === 0) return undefined;
  const stderr = outcome.stderr.trim();
  return stderr.length > 0
    ? `git ${verb} failed (exit ${outcome.exitCode}): ${stderr}`
    : `git ${verb} failed (exit ${outcome.exitCode})`;
}

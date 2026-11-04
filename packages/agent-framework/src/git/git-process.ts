/**
 * BEHAVIOR-2437: the port every `/git` verb runs git through, and the words a failed run is reported
 * in.
 *
 * The port is argv only: no user token is ever parsed as shell syntax, output is capped, the child is
 * bounded by a timeout, and every way a run can end is a typed outcome rather than a throw. Exit
 * codes are DATA: `diff --cached --quiet` answers with 1, and that is an answer, not an error. The
 * Node implementation of the port is `createGitProcess` in `@robota-sdk/agent-framework/node`; this
 * file runs nothing.
 */

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

/**
 * SELFHOST-011 P1 — the default eval `runFn`, built from an agent runtime.
 *
 * For each case input it spawns a FRESH headless session (so cases are independent — no cross-case history
 * contamination), submits the input, and resolves to the terminal `complete`-event `IExecutionResult` — the
 * FULL run result (response + `toolSummaries` + `usage` + `history`). This is deliberately NOT `createQuery`,
 * which resolves only to `result.response` (a `string`) and would collapse every metric into the string-only
 * shape the spec rejected. The caller owns provider/agent config via the runtime → the library stays neutral.
 *
 * Each per-case session is torn down with `shutdown()` in a `finally` once the run settles — the fresh-per-case
 * design would otherwise leak N live sessions (+ their background runners) across an N-case eval and could keep
 * the `robota eval` CI process from exiting.
 *
 * Security posture: programmatic eval runs default to `bypassPermissions` (below) so the agent is not blocked on
 * interactive approvals in a headless CI run — the agent may execute any tool (shell/write) without prompting.
 * Pass a stricter `permissionMode` (or `deniedTools`) in `options` to constrain an untrusted eval definition.
 */

import type { TEvalRunFn } from './eval-types.js';
import type { InteractiveSession } from '../interactive/interactive-session.js';
import type { IExecutionResult } from '../interactive/types.js';
import type { IAgentRuntime, IHeadlessSessionOptions } from '../runtime/agent-runtime.js';

/** Programmatic eval runs default to bypass so the agent is not blocked on interactive approvals. */
const DEFAULT_SESSION_OPTIONS: IHeadlessSessionOptions = { permissionMode: 'bypassPermissions' };

/** Submit one input and await the session's terminal event: `complete`/`interrupted` resolve, `error` rejects. */
function awaitRun(session: InteractiveSession, input: string): Promise<IExecutionResult> {
  return new Promise<IExecutionResult>((resolve, reject) => {
    const onComplete = (result: IExecutionResult): void => {
      cleanup();
      resolve(result);
    };
    // An interrupted (e.g. maxTurns-truncated) run still carries a full IExecutionResult and is scored like any
    // other; a metric that must reject truncated output can inspect the result (P2 may flag this distinctly).
    const onInterrupted = (result: IExecutionResult): void => {
      cleanup();
      resolve(result);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      session.off('complete', onComplete);
      session.off('interrupted', onInterrupted);
      session.off('error', onError);
    };

    session.on('complete', onComplete);
    session.on('interrupted', onInterrupted);
    session.on('error', onError);

    session.submit(input).catch((err) => {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

/**
 * Build a default `runFn` bound to an agent runtime. Each invocation runs one case in its own session, captures
 * that session's terminal `complete`/`interrupted` `IExecutionResult` (an `error` event rejects), and shuts the
 * session down before returning.
 */
export function createSessionRunFn(
  runtime: IAgentRuntime,
  options: IHeadlessSessionOptions = DEFAULT_SESSION_OPTIONS,
): TEvalRunFn {
  return async (input: string): Promise<IExecutionResult> => {
    const session = runtime.createSession(options);
    try {
      return await awaitRun(session, input);
    } finally {
      await session.shutdown();
    }
  };
}

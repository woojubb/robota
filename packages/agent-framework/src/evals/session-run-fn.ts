/**
 * SELFHOST-011 P1 — the default eval `runFn`, built from an agent runtime.
 *
 * For each case input it spawns a FRESH headless session (so cases are independent — no cross-case history
 * contamination), submits the input, and resolves to the terminal `complete`-event `IExecutionResult` — the
 * FULL run result (response + `toolSummaries` + `usage` + `history`). This is deliberately NOT `createQuery`,
 * which resolves only to `result.response` (a `string`) and would collapse every metric into the string-only
 * shape the spec rejected. The caller owns provider/agent config via the runtime → the library stays neutral.
 */

import type { TEvalRunFn } from './eval-types.js';
import type { IExecutionResult } from '../interactive/types.js';
import type { IAgentRuntime, IHeadlessSessionOptions } from '../runtime/agent-runtime.js';

/** Programmatic eval runs default to bypass so the agent is not blocked on interactive approvals. */
const DEFAULT_SESSION_OPTIONS: IHeadlessSessionOptions = { permissionMode: 'bypassPermissions' };

/**
 * Build a default `runFn` bound to an agent runtime. Each invocation runs one case in its own session and
 * captures that session's terminal `complete` (or `interrupted`) `IExecutionResult`; an `error` event rejects.
 */
export function createSessionRunFn(
  runtime: IAgentRuntime,
  options: IHeadlessSessionOptions = DEFAULT_SESSION_OPTIONS,
): TEvalRunFn {
  return (input: string): Promise<IExecutionResult> =>
    new Promise<IExecutionResult>((resolve, reject) => {
      const session = runtime.createSession(options);

      const onComplete = (result: IExecutionResult): void => {
        cleanup();
        resolve(result);
      };
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

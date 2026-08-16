/**
 * Streaming ENTRY into the one execution turn (CORE-042).
 *
 * This file used to be a second execution engine: it re-derived store setup, provider resolution,
 * chat options, provider-message derivation, tool execution, validation, commit and error
 * classification inline, and owned none of them. Every turn capability therefore had to be built
 * twice, and the forgotten copy failed silently — six commits in a row were the identical
 * "the streaming path dropped X, copy X in" patch, two of them found by users after publish.
 *
 * There is no second engine now. `runStream` runs the SAME `execute()` the round path runs, with a
 * queue-feeding `onTextDelta`, and yields the deltas as they arrive. Rounds, the post-tool model
 * call, the round cap, abort state, plugin hooks, replay events, caching and the capacity guard are
 * not re-implemented here — they are simply what the turn does.
 *
 * That the round path streams at all is not incidental: `IChatOptions.onTextDelta` is contractual
 * ("the provider should use streaming internally and call this for each text chunk, while still
 * returning the complete assembled message"), and it is the mechanism the shipped product already
 * renders from — the TUI, headless mode, the ws transport and agent-server all consume deltas fed
 * through `run()`, not through this entry point.
 */

import type { ICoreExecutionResult, IExecutionContext } from './execution-types';
import type { IAgentConfig } from '../interfaces/agent';
import type { TUniversalMessage } from '../interfaces/messages';

/** The turn this entry point streams. Injected so the seam stays one-directional and testable. */
export type TRunExecute = (
  input: string,
  messages: TUniversalMessage[],
  config: IAgentConfig,
  context: Partial<IExecutionContext>,
) => Promise<ICoreExecutionResult>;

/**
 * Run one turn, yield its text deltas, and return the turn's result.
 *
 * The RESULT is returned, not the response string, because `execute()` reports failure by resolving
 * with `success: false` and an `error` rather than by rejecting (CORE-020). Throwing that here would
 * put the failure rule in two layers; the caller applies the same check `robotaRun` applies, so one
 * rule lives in one place.
 *
 * The generator OWNS cancellation, not merely draining. A consumer that stops iterating (`break`,
 * `return`, an exception) must not leave the turn running: `execute()` is an in-flight promise here,
 * and an abandoned turn would keep writing to the conversation store after `Robota.runStream`'s
 * `finally` has already released the CORE-012 run slot and reset ephemeral history — interleaving a
 * dead turn's writes into the next run. So the `finally` aborts the turn and awaits it to settlement
 * before returning.
 */
export async function* executeStream(
  input: string,
  messages: TUniversalMessage[],
  config: IAgentConfig,
  context: Partial<IExecutionContext> | undefined,
  runExecute: TRunExecute,
): AsyncGenerator<string, ICoreExecutionResult> {
  const pending: string[] = [];
  let wake: (() => void) | null = null;
  let finished = false;
  let failure: unknown = null;
  // Boxed rather than a bare `let`: the assignment happens inside a callback, and TypeScript's
  // control-flow analysis narrows a captured `let` to its initializer at the read site.
  const settled: { result: ICoreExecutionResult | null } = { result: null };

  const abandon = new AbortController();
  const callerSignal = context?.signal;
  const signal = callerSignal ? AbortSignal.any([callerSignal, abandon.signal]) : abandon.signal;

  const callerOnTextDelta = context?.onTextDelta;
  const onTextDelta = (delta: string): void => {
    pending.push(delta);
    // The caller's own callback still fires: `IRunOptions.onTextDelta` reaches this context, and
    // swallowing it here would be a new instance of the drop this file exists to end.
    callerOnTextDelta?.(delta);
    wake?.();
  };

  const turn = runExecute(input, messages, config, { ...context, signal, onTextDelta })
    .then(
      (value) => {
        settled.result = value;
      },
      (error: unknown) => {
        failure = error;
      },
    )
    .finally(() => {
      finished = true;
      wake?.();
    });

  try {
    for (;;) {
      while (pending.length > 0) {
        yield pending.shift() as string;
      }
      if (finished) break;
      await new Promise<void>((resolve) => {
        wake = (): void => {
          wake = null;
          resolve();
        };
      });
    }
    if (failure !== null) {
      throw failure;
    }
    if (settled.result === null) {
      throw new Error('[EXECUTION] streaming turn settled without a result');
    }
    return settled.result;
  } finally {
    abandon.abort();
    await turn;
  }
}

import {
  createJsonFormatHandlers,
  effortData,
  formatEffortResolution,
  getSessionId,
  writeGoalStoppedResult,
  writeJsonResult,
} from './headless-output.js';
import { executeSlashCommandIfPresent, subscribeStreamJsonEvents } from './headless-stream-json.js';
export {
  getSessionId,
  GOAL_NOT_SATISFIED_EXIT_CODE,
  resolveErrorCode,
  writeJsonResult,
} from './headless-output.js';

import type { IHeadlessSession } from './headless-session.js';
import type { IModelEffortResolution } from '../../effort/effort-resolution.js';
import type { IExecutionResult, IGoalEvent } from '@robota-sdk/agent-interface-session';

/** Issue #2052: the ONE owner of the output-format vocabulary — type and runtime constant together. */
export const OUTPUT_FORMATS = ['text', 'json', 'stream-json'] as const;
export type TOutputFormat = (typeof OUTPUT_FORMATS)[number];

/** RUNTIME-36: normalize a caught unknown into an Error for the error/exit-code handlers. */
function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** GOAL-001: options for an autonomous headless goal run. */
export interface IHeadlessGoalOptions {
  maxIterations?: number;
}

export interface IHeadlessRunnerOptions {
  session: IHeadlessSession;
  outputFormat: TOutputFormat;
  /** Optional startup resolution projected into ordinary print results. */
  effortResolution?: IModelEffortResolution;
}

export function createHeadlessRunner(options: IHeadlessRunnerOptions): {
  run: (prompt: string) => Promise<number>;
  runGoal: (objective: string, goalOptions?: IHeadlessGoalOptions) => Promise<number>;
} {
  const { session, outputFormat, effortResolution } = options;
  return {
    run: (prompt: string): Promise<number> => {
      if (outputFormat === 'text') return runTextFormat(session, prompt, effortResolution);
      if (outputFormat === 'json') return runJsonFormat(session, prompt, effortResolution);
      return runStreamJsonFormat(session, prompt, effortResolution);
    },
    runGoal: (objective: string, goalOptions: IHeadlessGoalOptions = {}): Promise<number> =>
      runGoalFormat(session, objective, goalOptions, outputFormat, effortResolution),
  };
}

/**
 * GOAL-001: drive an autonomous goal to completion in headless mode. Streams each turn's response
 * for progress, then resolves when the goal stops: exit 0 if satisfied, {@link GOAL_NOT_SATISFIED_EXIT_CODE}
 * if it stopped at a bound (max-iterations / no-progress / cancelled), or 1 on a turn error.
 */
function runGoalFormat(
  session: IHeadlessSession,
  objective: string,
  goalOptions: IHeadlessGoalOptions,
  outputFormat: TOutputFormat,
  effortResolution?: IModelEffortResolution,
): Promise<number> {
  return new Promise<number>((resolve) => {
    const cleanup = (): void => {
      session.off('complete', onComplete);
      session.off('error', onError);
      session.off('goal_event', onGoal);
    };
    const onComplete = (result: IExecutionResult): void => {
      if (result.response) process.stdout.write(result.response + '\n');
    };
    const onError = (error: Error): void => {
      cleanup();
      if (outputFormat === 'text') process.stderr.write(error.message + '\n');
      else writeJsonResult(getSessionId(session), '', 'error', error);
      resolve(1);
    };
    const onGoal = (event: IGoalEvent): void =>
      writeGoalStoppedResult(session, event, outputFormat, effortResolution, cleanup, resolve);

    session.on('complete', onComplete);
    session.on('error', onError);
    session.on('goal_event', onGoal);

    void session.setGoal(
      objective,
      goalOptions.maxIterations ? { maxIterations: goalOptions.maxIterations } : {},
    );
  });
}

/**
 * CI-001: run the terminal action exactly once and settle the exit code.
 *
 * Two coupled hazards this closes:
 *  1. Ordering — the terminal `complete`/`interrupted`/`error` events fire from INSIDE the turn, BEFORE
 *     `session.submit()`'s awaited `finally` runs `persistSession()` / the checkpoint finalize. If `run()`
 *     resolved directly off those events, `start()` would return while the session was still writing
 *     session files in caller-configured storage — a race cleanup can lose (ENOTEMPTY). So each format
 *     records the code via `finalize()` and then AWAITS the underlying operation, guaranteeing all trailing
 *     turn work has drained before `run()` resolves.
 *  2. Duplication — since submit is now awaited in a try/catch, a terminal event AND a later submit
 *     rejection could both drive an error path. `finalize` runs its terminal action (cleanup + the single
 *     output write) only for the FIRST caller, so the JSON/stream output is always exactly one record.
 */
function createExitCodeLatch(): {
  finalize: (code: number, terminalAction: () => void) => void;
  value: () => number;
} {
  let code: number | undefined;
  return {
    finalize: (c: number, terminalAction: () => void): void => {
      if (code !== undefined) return;
      code = c;
      terminalAction();
    },
    // RUNTIME-36: fail closed — an operation that drained without emitting a terminal event is a non-zero
    // exit, never a hang and never a spurious 0.
    value: (): number => code ?? 1,
  };
}

async function runTextFormat(
  session: IHeadlessSession,
  prompt: string,
  effortResolution?: IModelEffortResolution,
): Promise<number> {
  const latch = createExitCodeLatch();
  const cleanup = (): void => {
    session.off('complete', onComplete);
    session.off('interrupted', onInterrupted);
    session.off('error', onError);
  };
  const onComplete = (result: IExecutionResult): void =>
    latch.finalize(0, () => {
      cleanup();
      process.stdout.write(result.response + '\n');
      if (effortResolution !== undefined) {
        process.stdout.write(formatEffortResolution(effortResolution) + '\n');
      }
    });
  const onInterrupted = (result: IExecutionResult): void =>
    latch.finalize(0, () => {
      cleanup();
      if (result.response) process.stdout.write(result.response + '\n');
      if (effortResolution !== undefined) {
        process.stdout.write(formatEffortResolution(effortResolution) + '\n');
      }
    });
  const onError = (error: Error): void =>
    latch.finalize(1, () => {
      cleanup();
      process.stderr.write(error.message + '\n');
    });

  session.on('complete', onComplete);
  session.on('interrupted', onInterrupted);
  session.on('error', onError);

  try {
    const cmd = await executeSlashCommandIfPresent(session, prompt);
    if (cmd.kind === 'command-result') {
      latch.finalize(cmd.result.success ? 0 : 1, () => {
        cleanup();
        process.stdout.write(cmd.result.message + '\n');
      });
    } else if (cmd.kind !== 'session-execution') {
      // CI-001: AWAIT submit so the turn's trailing work (persistSession / checkpoint finalize) drains
      // before run() resolves. RUNTIME-36: a thrown submit surfaces a non-zero exit via onError.
      await session.submit(prompt);
    }
  } catch (error) {
    onError(toError(error));
  }
  return latch.value();
}

async function runJsonFormat(
  session: IHeadlessSession,
  prompt: string,
  effortResolution?: IModelEffortResolution,
): Promise<number> {
  const latch = createExitCodeLatch();
  const cleanup = (): void => {
    session.off('complete', onComplete);
    session.off('interrupted', onInterrupted);
    session.off('error', onError);
  };
  const handlers = createJsonFormatHandlers(session, effortResolution, cleanup, latch.finalize);
  const { onComplete, onInterrupted, onError } = handlers;

  session.on('complete', onComplete);
  session.on('interrupted', onInterrupted);
  session.on('error', onError);

  try {
    const cmd = await executeSlashCommandIfPresent(session, prompt);
    if (cmd.kind === 'command-result') {
      latch.finalize(cmd.result.success ? 0 : 1, () => {
        cleanup();
        writeJsonResult(
          getSessionId(session),
          cmd.result.message,
          cmd.result.success ? 'success' : 'error',
          undefined,
          cmd.result.data,
        );
      });
    } else if (cmd.kind !== 'session-execution') {
      // CI-001: AWAIT submit so trailing turn work drains before run() resolves (see createExitCodeLatch).
      await session.submit(prompt);
    }
  } catch (error) {
    onError(toError(error));
  }
  return latch.value();
}

async function runStreamJsonFormat(
  session: IHeadlessSession,
  prompt: string,
  effortResolution?: IModelEffortResolution,
): Promise<number> {
  const latch = createExitCodeLatch();
  // subscribeStreamJsonEvents' terminal handlers each cleanup + write a single result then invoke this
  // callback; guard so a terminal event and the catch below cannot both write (see createExitCodeLatch).
  const settleFromEvent = (code: number): void => latch.finalize(code, () => undefined);
  const cleanup = subscribeStreamJsonEvents(
    session,
    getSessionId,
    (sessionId, result, subtype, error) =>
      writeJsonResult(sessionId, result, subtype, error, effortData(effortResolution)),
    settleFromEvent,
  );

  try {
    const cmd = await executeSlashCommandIfPresent(session, prompt);
    if (cmd.kind === 'command-result') {
      latch.finalize(cmd.result.success ? 0 : 1, () => {
        cleanup();
        writeJsonResult(
          getSessionId(session),
          cmd.result.message,
          cmd.result.success ? 'success' : 'error',
          undefined,
          cmd.result.data,
        );
      });
    } else if (cmd.kind !== 'session-execution') {
      // CI-001: AWAIT submit so trailing turn work drains before run() resolves (see createExitCodeLatch).
      await session.submit(prompt);
    }
  } catch (error) {
    // RUNTIME-36: route a thrown slash-command / failed submit to a non-zero exit instead of hanging.
    latch.finalize(1, () => {
      cleanup();
      writeJsonResult(getSessionId(session), '', 'error', toError(error));
    });
  }
  return latch.value();
}

import {
  createJsonFormatHandlers,
  effortData,
  formatEffortResolution,
  getSessionId,
  writeGoalStoppedResult,
  writeJsonResult,
} from './headless-output.js';
import { executeSlashCommandIfPresent, subscribeStreamJsonEvents } from './headless-stream-json.js';
import { humanizeApiError } from '../../utils/error-humanizer.js';
export {
  getSessionId,
  GOAL_NOT_SATISFIED_EXIT_CODE,
  resolveErrorCode,
  writeJsonResult,
} from './headless-output.js';

import type { IHeadlessOutput } from './headless-output.js';
import type { IHeadlessSession } from './headless-session.js';
import type { IModelEffortResolution } from '../../effort/effort-resolution.js';
import type { IProviderErrorGuidance } from '../../utils/error-humanizer.js';
import type { IExecutionResult, IGoalEvent } from '@robota-sdk/agent-interface-session';
import type { TOutputFormat } from './headless-output-format.js';

export { OUTPUT_FORMATS } from './headless-output-format.js';
export type { TOutputFormat } from './headless-output-format.js';
export type { IHeadlessOutput, IHeadlessTextSink } from './headless-output.js';

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
  /** Where results and diagnostics are written; the framework has no streams of its own. */
  output: IHeadlessOutput;
  outputFormat: TOutputFormat;
  /** Optional startup resolution projected into ordinary print results. */
  effortResolution?: IModelEffortResolution;
  providerErrorGuidance?: IProviderErrorGuidance;
}

export function createHeadlessRunner(options: IHeadlessRunnerOptions): {
  run: (prompt: string) => Promise<number>;
  runGoal: (objective: string, goalOptions?: IHeadlessGoalOptions) => Promise<number>;
} {
  const { session, output, outputFormat, effortResolution, providerErrorGuidance } = options;
  return {
    run: (prompt: string): Promise<number> => {
      if (outputFormat === 'text')
        return runTextFormat(output, session, prompt, effortResolution, providerErrorGuidance);
      if (outputFormat === 'json') return runJsonFormat(output, session, prompt, effortResolution);
      return runStreamJsonFormat(output, session, prompt, effortResolution);
    },
    runGoal: (objective: string, goalOptions: IHeadlessGoalOptions = {}): Promise<number> =>
      runGoalFormat(
        output,
        session,
        objective,
        goalOptions,
        outputFormat,
        effortResolution,
        providerErrorGuidance,
      ),
  };
}

/**
 * GOAL-001: drive an autonomous goal to completion in headless mode. Streams each turn's response
 * for progress, then resolves when the goal stops: exit 0 if satisfied, {@link GOAL_NOT_SATISFIED_EXIT_CODE}
 * if it stopped at a bound (max-iterations / no-progress / cancelled), or 1 on a turn error.
 */
function runGoalFormat(
  output: IHeadlessOutput,
  session: IHeadlessSession,
  objective: string,
  goalOptions: IHeadlessGoalOptions,
  outputFormat: TOutputFormat,
  effortResolution?: IModelEffortResolution,
  providerErrorGuidance?: IProviderErrorGuidance,
): Promise<number> {
  return new Promise<number>((resolve) => {
    const cleanup = (): void => {
      session.off('complete', onComplete);
      session.off('error', onError);
      session.off('goal_event', onGoal);
    };
    const onComplete = (result: IExecutionResult): void => {
      if (result.response) output.stdout.write(result.response + '\n');
    };
    const onError = (error: Error): void => {
      cleanup();
      if (outputFormat === 'text')
        output.stderr.write(humanizeApiError(error, providerErrorGuidance) + '\n');
      else writeJsonResult(output, getSessionId(session), '', 'error', error);
      resolve(1);
    };
    const onGoal = (event: IGoalEvent): void =>
      writeGoalStoppedResult(
        output,
        session,
        event,
        outputFormat,
        effortResolution,
        cleanup,
        resolve,
      );

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
  output: IHeadlessOutput,
  session: IHeadlessSession,
  prompt: string,
  effortResolution?: IModelEffortResolution,
  providerErrorGuidance?: IProviderErrorGuidance,
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
      output.stdout.write(result.response + '\n');
      if (effortResolution !== undefined) {
        output.stdout.write(formatEffortResolution(effortResolution) + '\n');
      }
    });
  const onInterrupted = (result: IExecutionResult): void =>
    latch.finalize(0, () => {
      cleanup();
      if (result.response) output.stdout.write(result.response + '\n');
      if (effortResolution !== undefined) {
        output.stdout.write(formatEffortResolution(effortResolution) + '\n');
      }
    });
  const onError = (error: Error): void =>
    latch.finalize(1, () => {
      cleanup();
      output.stderr.write(humanizeApiError(error, providerErrorGuidance) + '\n');
    });

  session.on('complete', onComplete);
  session.on('interrupted', onInterrupted);
  session.on('error', onError);

  try {
    const cmd = await executeSlashCommandIfPresent(session, prompt);
    if (cmd.kind === 'command-result') {
      latch.finalize(cmd.result.success ? 0 : 1, () => {
        cleanup();
        output.stdout.write(cmd.result.message + '\n');
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
  output: IHeadlessOutput,
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
  const handlers = createJsonFormatHandlers(
    output,
    session,
    effortResolution,
    cleanup,
    latch.finalize,
  );
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
          output,
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
  output: IHeadlessOutput,
  session: IHeadlessSession,
  prompt: string,
  effortResolution?: IModelEffortResolution,
): Promise<number> {
  const latch = createExitCodeLatch();
  // subscribeStreamJsonEvents' terminal handlers each cleanup + write a single result then invoke this
  // callback; guard so a terminal event and the catch below cannot both write (see createExitCodeLatch).
  const settleFromEvent = (code: number): void => latch.finalize(code, () => undefined);
  const cleanup = subscribeStreamJsonEvents(
    output,
    session,
    getSessionId,
    (sessionId, result, subtype, error) =>
      writeJsonResult(output, sessionId, result, subtype, error, effortData(effortResolution)),
    settleFromEvent,
  );

  try {
    const cmd = await executeSlashCommandIfPresent(session, prompt);
    if (cmd.kind === 'command-result') {
      latch.finalize(cmd.result.success ? 0 : 1, () => {
        cleanup();
        writeJsonResult(
          output,
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
      writeJsonResult(output, getSessionId(session), '', 'error', toError(error));
    });
  }
  return latch.value();
}

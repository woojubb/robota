import { EFFORT_LEVEL_LABELS } from '../../effort/effort-resolution.js';

import type { TOutputFormat } from './headless-output-format.js';
import type { IHeadlessSession } from './headless-session.js';
import type { IModelEffortResolution } from '../../effort/effort-resolution.js';
import type { IExecutionResult, IGoalEvent } from '@robota-sdk/agent-interface-session';

/** Exit code for a goal that stopped cleanly without being satisfied. */
export const GOAL_NOT_SATISFIED_EXIT_CODE = 2;

/** Somewhere text can be written; a Node `process.stdout` is one. */
export interface IHeadlessTextSink {
  write(text: string): unknown;
}

/**
 * Where a headless run writes: results on `stdout`, diagnostics on `stderr`. The framework owns no
 * streams of its own, so a Node composition root passes `{ stdout: process.stdout, stderr:
 * process.stderr }` and any other host passes whatever carries its output.
 */
export interface IHeadlessOutput {
  readonly stdout: IHeadlessTextSink;
  readonly stderr: IHeadlessTextSink;
}

/**
 * The same plain wording `/effort` itself reports (`EFFORT_LEVEL_LABELS`), replacing the
 * earlier `Model effort: requested=…, effective=…, source=…, disposition=…` internal-field dump for
 * headless `/goal` output. `not-applied` means the model has no matching native control at all — the
 * earlier fields carried no information a person could act on for that case, so it gets its own plain
 * sentence instead of a label, exactly as `/effort`'s own outcome text does.
 */
export function formatEffortResolution(resolution: IModelEffortResolution): string {
  if (resolution.disposition === 'not-applied') {
    return "This model doesn't support effort levels, so it will use its default.";
  }
  return `Effort: ${EFFORT_LEVEL_LABELS[resolution.requested]}`;
}

export function effortData(
  resolution: IModelEffortResolution | undefined,
): { effort: IModelEffortResolution } | undefined {
  return resolution === undefined ? undefined : { effort: resolution };
}

export function writeGoalStoppedResult(
  output: IHeadlessOutput,
  session: IHeadlessSession,
  event: IGoalEvent,
  outputFormat: TOutputFormat,
  effortResolution: IModelEffortResolution | undefined,
  cleanup: () => void,
  resolve: (code: number) => void,
): void {
  if (event.type !== 'goal_stopped') return;
  cleanup();
  const goal = event.goal;
  const satisfied = goal.stopReason === 'satisfied';
  const summary = satisfied
    ? `Goal satisfied after ${goal.iterations} iteration(s).`
    : `Goal stopped: ${goal.stopReason} (after ${goal.iterations} iteration(s)).`;
  if (outputFormat === 'text') {
    (satisfied ? output.stdout : output.stderr).write(summary + '\n');
    if (effortResolution !== undefined && satisfied) {
      output.stdout.write(formatEffortResolution(effortResolution) + '\n');
    }
  } else {
    writeJsonResult(
      output,
      getSessionId(session),
      summary,
      satisfied ? 'success' : 'error',
      undefined,
      effortData(effortResolution),
    );
  }
  resolve(satisfied ? 0 : GOAL_NOT_SATISFIED_EXIT_CODE);
}

export interface IJsonFormatHandlers {
  readonly onComplete: (result: IExecutionResult) => void;
  readonly onInterrupted: (result: IExecutionResult) => void;
  readonly onError: (error: Error) => void;
}

export function createJsonFormatHandlers(
  output: IHeadlessOutput,
  session: IHeadlessSession,
  effortResolution: IModelEffortResolution | undefined,
  cleanup: () => void,
  finalize: (code: number, terminalAction: () => void) => void,
): IJsonFormatHandlers {
  const writeSuccess = (result: IExecutionResult): void => {
    cleanup();
    writeJsonResult(
      output,
      getSessionId(session),
      result.response,
      'success',
      undefined,
      effortData(effortResolution),
    );
  };
  return {
    onComplete: (result: IExecutionResult): void => finalize(0, () => writeSuccess(result)),
    onInterrupted: (result: IExecutionResult): void => finalize(0, () => writeSuccess(result)),
    onError: (error: Error): void =>
      finalize(1, () => {
        cleanup();
        writeJsonResult(output, getSessionId(session), '', 'error', error);
      }),
  };
}

export function resolveErrorCode(error: Error): string {
  const msg = error.message.toLowerCase();
  if (msg.includes('api key') || msg.includes('no provider') || msg.includes('provider')) {
    return 'config_error';
  }
  if (msg.includes('tool') || msg.includes('execution')) {
    return 'tool_error';
  }
  return 'api_error';
}

export function writeJsonResult(
  output: IHeadlessOutput,
  sessionId: string,
  result: string,
  subtype: 'success' | 'error',
  error?: Error,
  data?: Record<string, unknown>,
): void {
  const payload: Record<string, unknown> = {
    type: 'result',
    result,
    session_id: sessionId,
    subtype,
  };
  if (subtype === 'error' && error !== undefined) {
    payload['error_code'] = resolveErrorCode(error);
  }
  if (data !== undefined) payload['data'] = data;
  const line = JSON.stringify(payload);
  output.stdout.write(line + '\n');
}

export function getSessionId(session: IHeadlessSession): string {
  try {
    return session.getSession().getSessionId();
  } catch {
    // allow-fallback: session may not be initialized yet
    return '';
  }
}

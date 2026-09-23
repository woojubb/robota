import type { TOutputFormat } from './headless-runner.js';
import type { IHeadlessSession } from './headless-session.js';
import type { IModelEffortResolution } from '../../effort/effort-resolution.js';
import type { IExecutionResult, IGoalEvent } from '@robota-sdk/agent-interface-session';

/** Exit code for a goal that stopped cleanly without being satisfied. */
export const GOAL_NOT_SATISFIED_EXIT_CODE = 2;

export function formatEffortResolution(resolution: IModelEffortResolution): string {
  return `Model effort: requested=${resolution.requested}, effective=${resolution.effective}, source=${resolution.source}, disposition=${resolution.disposition}.`;
}

export function effortData(
  resolution: IModelEffortResolution | undefined,
): { effort: IModelEffortResolution } | undefined {
  return resolution === undefined ? undefined : { effort: resolution };
}

export function writeGoalStoppedResult(
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
    (satisfied ? process.stdout : process.stderr).write(summary + '\n');
    if (effortResolution !== undefined && satisfied) {
      process.stdout.write(formatEffortResolution(effortResolution) + '\n');
    }
  } else {
    writeJsonResult(
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
  session: IHeadlessSession,
  effortResolution: IModelEffortResolution | undefined,
  cleanup: () => void,
  finalize: (code: number, terminalAction: () => void) => void,
): IJsonFormatHandlers {
  const writeSuccess = (result: IExecutionResult): void => {
    cleanup();
    writeJsonResult(
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
        writeJsonResult(getSessionId(session), '', 'error', error);
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
  const output = JSON.stringify(payload);
  process.stdout.write(output + '\n');
}

export function getSessionId(session: IHeadlessSession): string {
  try {
    return session.getSession().getSessionId();
  } catch {
    // allow-fallback: session may not be initialized yet
    return '';
  }
}

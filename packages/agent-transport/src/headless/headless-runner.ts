import { executeSlashCommandIfPresent, subscribeStreamJsonEvents } from './headless-stream-json.js';

import type {
  IExecutionResult,
  IGoalEvent,
  IInteractiveSession,
} from '@robota-sdk/agent-interface-transport';

export type TOutputFormat = 'text' | 'json' | 'stream-json';

/** GOAL-001: options for an autonomous headless goal run. */
export interface IHeadlessGoalOptions {
  maxIterations?: number;
}

export interface IHeadlessRunnerOptions {
  session: IInteractiveSession;
  outputFormat: TOutputFormat;
}

/** Exit code for a goal that stopped cleanly without being satisfied (bound/convergence/cancel). */
export const GOAL_NOT_SATISFIED_EXIT_CODE = 2;

export function createHeadlessRunner(options: IHeadlessRunnerOptions): {
  run: (prompt: string) => Promise<number>;
  runGoal: (objective: string, goalOptions?: IHeadlessGoalOptions) => Promise<number>;
} {
  const { session, outputFormat } = options;
  return {
    run: (prompt: string): Promise<number> => {
      if (outputFormat === 'text') return runTextFormat(session, prompt);
      if (outputFormat === 'json') return runJsonFormat(session, prompt);
      return runStreamJsonFormat(session, prompt);
    },
    runGoal: (objective: string, goalOptions: IHeadlessGoalOptions = {}): Promise<number> =>
      runGoalFormat(session, objective, goalOptions, outputFormat),
  };
}

/**
 * GOAL-001: drive an autonomous goal to completion in headless mode. Streams each turn's response
 * for progress, then resolves when the goal stops: exit 0 if satisfied, {@link GOAL_NOT_SATISFIED_EXIT_CODE}
 * if it stopped at a bound (max-iterations / no-progress / cancelled), or 1 on a turn error.
 */
function runGoalFormat(
  session: IInteractiveSession,
  objective: string,
  goalOptions: IHeadlessGoalOptions,
  outputFormat: TOutputFormat,
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
    const onGoal = (event: IGoalEvent): void => {
      if (event.type !== 'goal_stopped') return;
      cleanup();
      const goal = event.goal;
      const satisfied = goal.stopReason === 'satisfied';
      const summary = satisfied
        ? `Goal satisfied after ${goal.iterations} iteration(s).`
        : `Goal stopped: ${goal.stopReason} (after ${goal.iterations} iteration(s)).`;
      if (outputFormat === 'text')
        (satisfied ? process.stdout : process.stderr).write(summary + '\n');
      else writeJsonResult(getSessionId(session), summary, satisfied ? 'success' : 'error');
      resolve(satisfied ? 0 : GOAL_NOT_SATISFIED_EXIT_CODE);
    };

    session.on('complete', onComplete);
    session.on('error', onError);
    session.on('goal_event', onGoal);

    void session.setGoal(
      objective,
      goalOptions.maxIterations ? { maxIterations: goalOptions.maxIterations } : {},
    );
  });
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
  const output = JSON.stringify(payload);
  process.stdout.write(output + '\n');
}

export function getSessionId(session: IInteractiveSession): string {
  try {
    return session.getSession().getSessionId();
  } catch {
    // allow-fallback: session may not be initialized yet
    return '';
  }
}

function runTextFormat(session: IInteractiveSession, prompt: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const cleanup = (): void => {
      session.off('complete', onComplete);
      session.off('interrupted', onInterrupted);
      session.off('error', onError);
    };
    const onComplete = (result: IExecutionResult): void => {
      cleanup();
      process.stdout.write(result.response + '\n');
      resolve(0);
    };
    const onInterrupted = (result: IExecutionResult): void => {
      cleanup();
      if (result.response) process.stdout.write(result.response + '\n');
      resolve(0);
    };
    const onError = (error: Error): void => {
      cleanup();
      process.stderr.write(error.message + '\n');
      resolve(1);
    };

    session.on('complete', onComplete);
    session.on('interrupted', onInterrupted);
    session.on('error', onError);

    void executeSlashCommandIfPresent(session, prompt).then((cmd) => {
      if (cmd.kind === 'command-result') {
        cleanup();
        process.stdout.write(cmd.result.message + '\n');
        resolve(cmd.result.success ? 0 : 1);
        return;
      }
      if (cmd.kind !== 'session-execution') void session.submit(prompt);
    });
  });
}

function runJsonFormat(session: IInteractiveSession, prompt: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const cleanup = (): void => {
      session.off('complete', onComplete);
      session.off('interrupted', onInterrupted);
      session.off('error', onError);
    };
    const onComplete = (result: IExecutionResult): void => {
      cleanup();
      writeJsonResult(getSessionId(session), result.response, 'success');
      resolve(0);
    };
    const onInterrupted = (result: IExecutionResult): void => {
      cleanup();
      writeJsonResult(getSessionId(session), result.response, 'success');
      resolve(0);
    };
    const onError = (error: Error): void => {
      cleanup();
      writeJsonResult(getSessionId(session), '', 'error', error);
      resolve(1);
    };

    session.on('complete', onComplete);
    session.on('interrupted', onInterrupted);
    session.on('error', onError);

    void executeSlashCommandIfPresent(session, prompt).then((cmd) => {
      if (cmd.kind === 'command-result') {
        cleanup();
        writeJsonResult(
          getSessionId(session),
          cmd.result.message,
          cmd.result.success ? 'success' : 'error',
        );
        resolve(cmd.result.success ? 0 : 1);
        return;
      }
      if (cmd.kind !== 'session-execution') void session.submit(prompt);
    });
  });
}

function runStreamJsonFormat(session: IInteractiveSession, prompt: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const cleanup = subscribeStreamJsonEvents(session, getSessionId, writeJsonResult, resolve);

    void executeSlashCommandIfPresent(session, prompt).then((cmd) => {
      if (cmd.kind === 'command-result') {
        cleanup();
        writeJsonResult(
          getSessionId(session),
          cmd.result.message,
          cmd.result.success ? 'success' : 'error',
        );
        resolve(cmd.result.success ? 0 : 1);
        return;
      }
      if (cmd.kind !== 'session-execution') void session.submit(prompt);
    });
  });
}

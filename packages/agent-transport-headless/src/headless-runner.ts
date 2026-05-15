import type { IInteractiveSession, IExecutionResult } from '@robota-sdk/agent-sdk';
import { executeSlashCommandIfPresent, subscribeStreamJsonEvents } from './headless-stream-json.js';

export type TOutputFormat = 'text' | 'json' | 'stream-json';

export interface IHeadlessRunnerOptions {
  session: IInteractiveSession;
  outputFormat: TOutputFormat;
}

export function createHeadlessRunner(options: IHeadlessRunnerOptions): {
  run: (prompt: string) => Promise<number>;
} {
  const { session, outputFormat } = options;
  return {
    run: (prompt: string): Promise<number> => {
      if (outputFormat === 'text') return runTextFormat(session, prompt);
      if (outputFormat === 'json') return runJsonFormat(session, prompt);
      return runStreamJsonFormat(session, prompt);
    },
  };
}

export function writeJsonResult(
  sessionId: string,
  result: string,
  subtype: 'success' | 'error',
): void {
  const output = JSON.stringify({ type: 'result', result, session_id: sessionId, subtype });
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
    const onError = (_error: Error): void => {
      cleanup();
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
    const onError = (_error: Error): void => {
      cleanup();
      writeJsonResult(getSessionId(session), '', 'error');
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

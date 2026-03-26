import { randomUUID } from 'node:crypto';
import type { InteractiveSession, IExecutionResult } from '@robota-sdk/agent-sdk';

export type TOutputFormat = 'text' | 'json' | 'stream-json';

export interface IHeadlessRunnerOptions {
  session: InteractiveSession;
  outputFormat: TOutputFormat;
}

export function createHeadlessRunner(options: IHeadlessRunnerOptions): {
  run: (prompt: string) => Promise<number>;
} {
  const { session, outputFormat } = options;

  return {
    run: (prompt: string): Promise<number> => {
      if (outputFormat === 'text') {
        return runTextFormat(session, prompt);
      }
      if (outputFormat === 'json') {
        return runJsonFormat(session, prompt);
      }
      return runStreamJsonFormat(session, prompt);
    },
  };
}

function writeJsonResult(sessionId: string, result: string, subtype: 'success' | 'error'): void {
  const output = JSON.stringify({ type: 'result', result, session_id: sessionId, subtype });
  process.stdout.write(output + '\n');
}

function runJsonFormat(session: InteractiveSession, prompt: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const sessionId = session.getSession().getSessionId();

    const cleanup = (): void => {
      session.off('complete', onComplete);
      session.off('interrupted', onInterrupted);
      session.off('error', onError);
    };

    const onComplete = (result: IExecutionResult): void => {
      cleanup();
      writeJsonResult(sessionId, result.response, 'success');
      resolve(0);
    };

    const onInterrupted = (result: IExecutionResult): void => {
      cleanup();
      writeJsonResult(sessionId, result.response, 'success');
      resolve(0);
    };

    const onError = (_error: Error): void => {
      cleanup();
      writeJsonResult(sessionId, '', 'error');
      resolve(1);
    };

    session.on('complete', onComplete);
    session.on('interrupted', onInterrupted);
    session.on('error', onError);

    void session.submit(prompt);
  });
}

function runStreamJsonFormat(session: InteractiveSession, prompt: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const sessionId = session.getSession().getSessionId();

    const cleanup = (): void => {
      session.off('text_delta', onTextDelta);
      session.off('complete', onComplete);
      session.off('interrupted', onInterrupted);
      session.off('error', onError);
    };

    const onTextDelta = (text: string): void => {
      const output = JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text },
        },
        session_id: sessionId,
        uuid: randomUUID(),
      });
      process.stdout.write(output + '\n');
    };

    const onComplete = (result: IExecutionResult): void => {
      cleanup();
      writeJsonResult(sessionId, result.response, 'success');
      resolve(0);
    };

    const onInterrupted = (result: IExecutionResult): void => {
      cleanup();
      writeJsonResult(sessionId, result.response, 'success');
      resolve(0);
    };

    const onError = (_error: Error): void => {
      cleanup();
      writeJsonResult(sessionId, '', 'error');
      resolve(1);
    };

    session.on('text_delta', onTextDelta);
    session.on('complete', onComplete);
    session.on('interrupted', onInterrupted);
    session.on('error', onError);

    void session.submit(prompt);
  });
}

function runTextFormat(session: InteractiveSession, prompt: string): Promise<number> {
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
      if (result.response) {
        process.stdout.write(result.response + '\n');
      }
      resolve(0);
    };

    const onError = (_error: Error): void => {
      cleanup();
      resolve(1);
    };

    session.on('complete', onComplete);
    session.on('interrupted', onInterrupted);
    session.on('error', onError);

    void session.submit(prompt);
  });
}

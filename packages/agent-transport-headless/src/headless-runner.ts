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
      // json and stream-json formats will be implemented in later tasks
      return Promise.resolve(0);
    },
  };
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

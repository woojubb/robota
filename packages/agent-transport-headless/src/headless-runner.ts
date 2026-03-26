import type { InteractiveSession } from '@robota-sdk/agent-sdk';

export type TOutputFormat = 'text' | 'json' | 'stream-json';

export interface IHeadlessRunnerOptions {
  session: InteractiveSession;
  outputFormat: TOutputFormat;
}

export function createHeadlessRunner(_options: IHeadlessRunnerOptions): {
  run: (prompt: string) => Promise<number>;
} {
  return {
    run: async (_prompt: string) => 0,
  };
}

import { PlaygroundStatisticsPlugin } from '../plugins/playground-statistics-plugin';
import type { TPlaygroundMode } from '../robota-executor-types';

interface IExecutionStatsInput {
  success: boolean;
  duration: number;
  streaming: boolean;
  error?: string;
}

export async function recordExecutionStats(
  statisticsPlugin: PlaygroundStatisticsPlugin,
  mode: TPlaygroundMode,
  opts: IExecutionStatsInput,
): Promise<void> {
  await statisticsPlugin.recordPlaygroundExecution({
    success: opts.success,
    duration: opts.duration,
    provider: 'openai',
    model: 'gpt-4',
    mode,
    streaming: opts.streaming,
    timestamp: new Date(),
    error: opts.error,
  });
}

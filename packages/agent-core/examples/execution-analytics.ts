/**
 * Execution analytics example for @robota-sdk/agent-core.
 *
 * Requirements:
 * - OPENAI_API_KEY
 */

import { Robota, ExecutionAnalyticsPlugin } from '@robota-sdk/agent-core';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }

  const analyticsPlugin = new ExecutionAnalyticsPlugin({
    maxEntries: 100,
    trackErrors: true,
    performanceThreshold: 2000,
    enableWarnings: true,
  });

  const agent = new Robota({
    name: 'AnalyticsAgent',
    aiProviders: [new OpenAIProvider({ apiKey })],
    defaultModel: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemMessage: 'You are a helpful assistant.',
    },
    plugins: [analyticsPlugin],
  });

  await agent.run('What is AI?');
  await agent.run('Tell me about ML in one paragraph.');

  const stats = analyticsPlugin.getAggregatedStats();
  // eslint-disable-next-line no-console -- examples CLI entrypoint
  console.log({
    totalExecutions: stats.totalExecutions,
    successful: stats.successfulExecutions,
    failed: stats.failedExecutions,
    averageDurationMs: Math.round(stats.averageDuration),
  });

  await agent.destroy();
}

main().catch((error: unknown) => {
  const err = error instanceof Error ? error : new Error(String(error));
  // eslint-disable-next-line no-console -- examples CLI entrypoint
  console.error(err.message);
  process.exit(1);
});

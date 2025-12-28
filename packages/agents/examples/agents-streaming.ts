/**
 * Streaming example for @robota-sdk/agents.
 *
 * Requirements:
 * - OPENAI_API_KEY
 */

import { Robota, PerformancePlugin } from '@robota-sdk/agents';
import type { IAgentConfig } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';

async function main(): Promise<void> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY environment variable is required');
    }

    const performancePlugin = new PerformancePlugin({
        strategy: 'memory',
        monitorMemory: true,
        aggregateStats: true
    });

    const config: IAgentConfig = {
        name: 'StreamingAgent',
        aiProviders: [new OpenAIProvider({ apiKey })],
        defaultModel: { provider: 'openai', model: 'gpt-4o-mini' },
        plugins: [performancePlugin],
        logging: { level: 'silent', enabled: false }
    };

    const robota = new Robota(config);

    let chunks = 0;
    for await (const chunk of robota.runStream('Tell me about space in 3 short sentences.')) {
        chunks += 1;
        // eslint-disable-next-line no-console -- examples CLI entrypoint
        process.stdout.write(chunk);
    }
    // eslint-disable-next-line no-console -- examples CLI entrypoint
    console.log(`\n\n[chunks: ${chunks}]`);

    const stats = await performancePlugin.getAggregatedStats();
    // eslint-disable-next-line no-console -- examples CLI entrypoint
    console.log({ totalOperations: stats.totalOperations, averageDurationMs: Math.round(stats.averageDuration) });

    await robota.destroy();
}

main().catch((error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    // eslint-disable-next-line no-console -- examples CLI entrypoint
    console.error(err.message);
    process.exit(1);
});



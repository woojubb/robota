/**
 * Basic usage example for @robota-sdk/agents.
 *
 * Requirements:
 * - OPENAI_API_KEY
 */

import { Robota, LoggingPlugin, UsagePlugin } from '@robota-sdk/agents';
import type { IAgentConfig } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';

async function main(): Promise<void> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY environment variable is required');
    }

    const usagePlugin = new UsagePlugin({ strategy: 'memory' });

    const config: IAgentConfig = {
        name: 'DemoAgent',
        aiProviders: [new OpenAIProvider({ apiKey })],
        defaultModel: { provider: 'openai', model: 'gpt-4o-mini' },
        plugins: [
            new LoggingPlugin({ level: 'info', enabled: true, strategy: 'console' }),
            usagePlugin
        ],
        logging: { level: 'info', enabled: true }
    };

    const robota = new Robota(config);
    const response = await robota.run('What is an AI agent?');
    // eslint-disable-next-line no-console -- examples CLI entrypoint
    console.log(response);

    const aggregated = await usagePlugin.getAggregatedStats();
    // eslint-disable-next-line no-console -- examples CLI entrypoint
    console.log({ totalRequests: aggregated.totalRequests, totalTokens: aggregated.totalTokens });

    await robota.destroy();
}

main().catch((error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    // eslint-disable-next-line no-console -- examples CLI entrypoint
    console.error(err.message);
    process.exit(1);
});



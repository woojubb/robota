/**
 * Advanced features example for @robota-sdk/agents.
 *
 * Requirements:
 * - OPENAI_API_KEY
 */

import { Robota, LoggingPlugin } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';

async function main(): Promise<void> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY environment variable is required');
    }

    const loggingPlugin = new LoggingPlugin({
        level: 'info',
        strategy: 'console'
    });

    const robota = new Robota({
        name: 'AdvancedAgent',
        aiProviders: [new OpenAIProvider({ apiKey })],
        defaultModel: {
            provider: 'openai',
            model: 'gpt-4o-mini',
            systemMessage: 'You are an advanced AI assistant with detailed analytical capabilities.'
        },
        plugins: [loggingPlugin]
    });

    const response = await robota.run('What is AI?');
    // eslint-disable-next-line no-console -- examples CLI entrypoint
    console.log(response);

    await robota.destroy();
}

main().catch((error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    // eslint-disable-next-line no-console -- examples CLI entrypoint
    console.error(err.message);
    process.exit(1);
});



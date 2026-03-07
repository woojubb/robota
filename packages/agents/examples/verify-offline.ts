import { AbstractAIProvider } from '../src/abstracts/abstract-ai-provider.ts';
import { Robota } from '../src/core/robota.ts';
import type { IChatOptions } from '../src/interfaces/provider.ts';
import type { TUniversalMessage } from '../src/interfaces/messages.ts';

class MockAIProvider extends AbstractAIProvider {
    override readonly name = 'mock-provider';
    override readonly version = '1.0.0';

    override async chat(messages: TUniversalMessage[], _options?: IChatOptions): Promise<TUniversalMessage> {
        const last = messages.at(-1);
        const content = typeof last?.content === 'string' ? last.content : '';

        return {
            role: 'assistant',
            content: `offline:${content}`,
            timestamp: new Date(),
        };
    }

    override async *chatStream(messages: TUniversalMessage[], _options?: IChatOptions): AsyncIterable<TUniversalMessage> {
        const last = messages.at(-1);
        const content = typeof last?.content === 'string' ? last.content : '';

        yield {
            role: 'assistant',
            content: 'stream:',
            timestamp: new Date(),
        };
        yield {
            role: 'assistant',
            content,
            timestamp: new Date(),
        };
    }
}

async function collectStream(agent: Robota): Promise<string> {
    let output = '';
    for await (const chunk of agent.runStream('verify-stream')) {
        output += chunk;
    }
    return output;
}

async function main(): Promise<void> {
    const agent = new Robota({
        name: 'OfflineVerifyAgent',
        aiProviders: [new MockAIProvider()],
        defaultModel: {
            provider: 'mock-provider',
            model: 'offline-model',
        },
        logging: {
            enabled: false,
            level: 'silent',
        },
    });

    const response = await agent.run('verify-run');
    if (response !== 'offline:verify-run') {
        throw new Error(`Unexpected run response: ${response}`);
    }

    const streamed = await collectStream(agent);
    if (streamed !== 'stream:verify-stream') {
        throw new Error(`Unexpected stream response: ${streamed}`);
    }

    await agent.destroy();
    process.stdout.write('agents offline verify passed.\n');
}

void main();

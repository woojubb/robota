/**
 * OpenAI streaming debug example for @robota-sdk/openai.
 *
 * Requirements:
 * - OPENAI_API_KEY
 *
 * Inspects streaming chunks and tool-call fragments as produced by OpenAIProvider.
 */

import { OpenAIProvider } from '@robota-sdk/openai';
import type { IAssistantMessage, IToolSchema, TUniversalMessage } from '@robota-sdk/agents';

async function main(): Promise<void> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY environment variable is required');
    }

    const openaiProvider = new OpenAIProvider({ apiKey });

    const messages: TUniversalMessage[] = [
        { role: 'user', content: 'Write a cafe launch plan with two sections: market analysis and menu outline.', timestamp: new Date() }
    ];

    const tools: IToolSchema[] = [
        {
            name: 'assignTask',
            description: 'Assign a new task to a specialized agent.',
            parameters: {
                type: 'object',
                properties: {
                    jobDescription: { type: 'string', description: 'Clear description of the task for the agent to execute.' }
                },
                required: ['jobDescription']
            }
        }
    ];

    const stream = openaiProvider.chatStream(messages, { model: 'gpt-4o-mini', tools });

    let chunkCount = 0;
    for await (const chunk of stream) {
        chunkCount += 1;
        const assistantChunk = chunk as IAssistantMessage;
        // eslint-disable-next-line no-console -- examples CLI entrypoint
        console.log(`[chunk ${chunkCount}]`, {
            role: chunk.role,
            contentPreview: typeof chunk.content === 'string' ? chunk.content.slice(0, 80) : null,
            toolCalls: assistantChunk.toolCalls?.length ?? 0
        });
    }
}

main().catch((error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    // eslint-disable-next-line no-console -- examples CLI entrypoint
    console.error(err.message);
    process.exit(1);
});



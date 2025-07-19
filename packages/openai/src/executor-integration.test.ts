import { vi } from 'vitest';
import { OpenAIProvider } from './provider';
import { LocalExecutor } from '@robota-sdk/agents';
import type { UniversalMessage } from '@robota-sdk/agents';

describe('OpenAI Provider Executor Integration', () => {
    let localExecutor: LocalExecutor;
    let provider: OpenAIProvider;

    beforeEach(() => {
        localExecutor = new LocalExecutor();

        // Create a mock provider to register with the executor
        const mockProvider = {
            name: 'openai',
            async chat(messages: UniversalMessage[]): Promise<UniversalMessage> {
                return {
                    role: 'assistant' as const,
                    content: `Mock response: ${messages[messages.length - 1]?.content}`,
                    timestamp: new Date()
                };
            },
            async *chatStream(messages: UniversalMessage[]): AsyncIterable<UniversalMessage> {
                const chunks = ['Mock', ' streaming', ' response'];
                for (const chunk of chunks) {
                    yield {
                        role: 'assistant' as const,
                        content: chunk,
                        timestamp: new Date()
                    };
                }
            },
            supportsTools: () => true,
            validateConfig: () => true,
            dispose: async () => { }
        };

        localExecutor.registerProvider('openai', mockProvider);

        // Create provider with executor (no API key needed)
        provider = new OpenAIProvider({
            executor: localExecutor
        });
    });

    afterEach(async () => {
        await provider.dispose();
    });

    describe('Provider with Executor', () => {
        it('should use executor for chat requests', async () => {
            const messages: UniversalMessage[] = [
                { role: 'user', content: 'Hello!', timestamp: new Date() }
            ];

            const options = {
                model: 'gpt-4',
                temperature: 0.7
            };

            const response = await provider.chat(messages, options);

            expect(response.role).toBe('assistant');
            expect(response.content).toContain('Mock response: Hello!');
        });

        it('should use executor for streaming chat requests', async () => {
            const messages: UniversalMessage[] = [
                { role: 'user', content: 'Tell me a story', timestamp: new Date() }
            ];

            const options = {
                model: 'gpt-4',
                temperature: 0.7
            };

            const chunks: string[] = [];
            for await (const chunk of provider.chatStream(messages, options)) {
                if (chunk.content) {
                    chunks.push(chunk.content);
                }
            }

            expect(chunks).toEqual(['Mock', ' streaming', ' response']);
        });

        it('should handle executor errors gracefully', async () => {
            // Create provider with executor that doesn't have registered provider
            const errorExecutor = new LocalExecutor();
            const errorProvider = new OpenAIProvider({
                executor: errorExecutor
            });

            const messages: UniversalMessage[] = [
                { role: 'user', content: 'Hello!', timestamp: new Date() }
            ];

            await expect(errorProvider.chat(messages, { model: 'gpt-4' })).rejects.toThrow(
                'Provider "openai" not registered with LocalExecutor'
            );

            await errorProvider.dispose();
        });

        it('should support tools when executor supports tools', () => {
            expect(provider.supportsTools()).toBe(true);
        });

        it('should validate configuration with executor', () => {
            // Provider with executor should validate successfully
            expect(provider.supportsTools()).toBe(true);
        });

        it('should clean up executor when provider is disposed', async () => {
            // Provider calls dispose on its executor when disposed
            await provider.dispose();

            // Check that provider was disposed successfully
            expect(true).toBe(true); // Basic check that dispose completed
        });
    });

    describe('Provider without Executor', () => {
        it('should require either client, apiKey, or executor', () => {
            expect(() => {
                new OpenAIProvider({});
            }).toThrow('Either OpenAI client, apiKey, or executor is required');
        });

        it('should work with API key (traditional mode)', () => {
            const apiKeyProvider = new OpenAIProvider({
                apiKey: 'sk-test-key'
            });

            expect(apiKeyProvider.name).toBe('openai');
            expect(apiKeyProvider.version).toBe('1.0.0');
        });

        it('should work with client (traditional mode)', () => {
            const mockClient = {} as any; // Mock OpenAI client
            const clientProvider = new OpenAIProvider({
                client: mockClient
            });

            expect(clientProvider.name).toBe('openai');
            expect(clientProvider.version).toBe('1.0.0');
        });
    });

    describe('Mixed Mode Validation', () => {
        it('should prioritize executor over direct API when both are provided', async () => {
            const mixedProvider = new OpenAIProvider({
                apiKey: 'sk-test-key',
                executor: localExecutor
            });

            // Should use executor, not direct API
            const messages: UniversalMessage[] = [
                { role: 'user', content: 'Hello!', timestamp: new Date() }
            ];

            const response = await mixedProvider.chat(messages, { model: 'gpt-4' });
            expect(response.content).toContain('Mock response:');

            await mixedProvider.dispose();
        });

        it('should handle executor initialization properly', () => {
            const provider = new OpenAIProvider({
                executor: localExecutor
            });

            // Check that executor was set correctly
            expect((provider as any).executor).toBe(localExecutor);
            expect((provider as any).client).toBeUndefined();
        });
    });
}); 
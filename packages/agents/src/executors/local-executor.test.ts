import { vi } from 'vitest';
import { LocalExecutor } from './local-executor';
import type { AIProviderInstance } from './local-executor';
import type { UniversalMessage, AssistantMessage } from '../managers/conversation-history-manager';

describe('LocalExecutor', () => {
    let executor: LocalExecutor;
    let mockProvider: AIProviderInstance;

    beforeEach(() => {
        executor = new LocalExecutor();

        // Create mock provider
        mockProvider = {
            name: 'test-provider',
            async chat(messages: UniversalMessage[], options?: any): Promise<UniversalMessage> {
                return {
                    role: 'assistant',
                    content: `Mock response to: ${messages[messages.length - 1]?.content}`,
                    timestamp: new Date()
                };
            },
            async *chatStream(messages: UniversalMessage[], options?: any): AsyncIterable<UniversalMessage> {
                yield {
                    role: 'assistant',
                    content: 'Mock',
                    timestamp: new Date()
                };
                yield {
                    role: 'assistant',
                    content: ' streaming',
                    timestamp: new Date()
                };
                yield {
                    role: 'assistant',
                    content: ' response',
                    timestamp: new Date()
                };
            },
            supportsTools(): boolean {
                return true;
            },
            validateConfig(): boolean {
                return true;
            },
            async dispose(): Promise<void> {
                // Mock dispose
            }
        };
    });

    afterEach(async () => {
        await executor.dispose();
    });

    describe('Provider Registration', () => {
        it('should register and retrieve providers', () => {
            executor.registerProvider('test', mockProvider);

            const retrieved = executor.getProvider('test');
            expect(retrieved).toBe(mockProvider);
        });

        it('should unregister providers', () => {
            executor.registerProvider('test', mockProvider);
            executor.unregisterProvider('test');

            const retrieved = executor.getProvider('test');
            expect(retrieved).toBeUndefined();
        });

        it('should return undefined for non-existent providers', () => {
            const retrieved = executor.getProvider('non-existent');
            expect(retrieved).toBeUndefined();
        });
    });

    describe('Chat Execution', () => {
        beforeEach(() => {
            executor.registerProvider('test', mockProvider);
        });

        it('should execute chat requests successfully', async () => {
            const request = {
                messages: [{ role: 'user' as const, content: 'Hello!', timestamp: new Date() }],
                provider: 'test',
                model: 'test-model',
                options: { temperature: 0.7 }
            };

            const response = await executor.executeChat(request);

            expect(response.role).toBe('assistant');
            expect(response.content).toContain('Mock response to: Hello!');
        });

        it('should throw error for unregistered provider', async () => {
            const request = {
                messages: [{ role: 'user' as const, content: 'Hello!', timestamp: new Date() }],
                provider: 'unregistered',
                model: 'test-model'
            };

            await expect(executor.executeChat(request)).rejects.toThrow(
                'Provider "unregistered" not registered with LocalExecutor'
            );
        });

        it('should execute streaming chat requests', async () => {
            const request = {
                messages: [{ role: 'user' as const, content: 'Tell me a story', timestamp: new Date() }],
                provider: 'test',
                model: 'test-model',
                stream: true as const
            };

            const chunks: string[] = [];
            for await (const chunk of executor.executeChatStream(request)) {
                if (chunk.content) {
                    chunks.push(chunk.content);
                }
            }

            expect(chunks).toEqual(['Mock', ' streaming', ' response']);
        });
    });

    describe('Configuration Validation', () => {
        it('should validate configuration successfully with valid config', () => {
            const validExecutor = new LocalExecutor({
                timeout: 30000,
                maxRetries: 3,
                retryDelay: 1000,
                enableLogging: false
            });

            expect(validExecutor.validateConfig()).toBe(true);
        });

        it('should fail validation with invalid timeout', () => {
            const invalidExecutor = new LocalExecutor({
                timeout: -1000
            });

            expect(invalidExecutor.validateConfig()).toBe(false);
        });

        it('should fail validation with invalid retries', () => {
            const invalidExecutor = new LocalExecutor({
                maxRetries: -5
            });

            expect(invalidExecutor.validateConfig()).toBe(false);
        });
    });

    describe('Tool Support', () => {
        it('should support tools when registered providers support tools', () => {
            executor.registerProvider('test', mockProvider);
            expect(executor.supportsTools()).toBe(true);
        });

        it('should not support tools when no providers are registered', () => {
            expect(executor.supportsTools()).toBe(false);
        });
    });

    describe('Lifecycle Management', () => {
        it('should dispose all registered providers', async () => {
            const disposeSpy = vi.fn();
            const providerWithDispose = {
                ...mockProvider,
                dispose: disposeSpy
            };

            executor.registerProvider('test', providerWithDispose);
            await executor.dispose();

            expect(disposeSpy).toHaveBeenCalled();
        });

        it('should clear providers after disposal', async () => {
            executor.registerProvider('test', mockProvider);
            await executor.dispose();

            const retrieved = executor.getProvider('test');
            expect(retrieved).toBeUndefined();
        });
    });

    describe('Error Handling', () => {
        it('should handle provider without chat method', async () => {
            const providerWithoutChat: AIProviderInstance = {
                name: 'incomplete-provider',
                supportsTools: () => false,
                validateConfig: () => true
            };

            executor.registerProvider('incomplete', providerWithoutChat);

            const request = {
                messages: [{ role: 'user' as const, content: 'Hello!', timestamp: new Date() }],
                provider: 'incomplete',
                model: 'test-model'
            };

            await expect(executor.executeChat(request)).rejects.toThrow(
                'Provider "incomplete" does not implement chat method'
            );
        });

        it('should handle provider without chatStream method', async () => {
            const providerWithoutStream: AIProviderInstance = {
                name: 'no-stream-provider',
                chat: mockProvider.chat!,
                supportsTools: () => false,
                validateConfig: () => true
            };

            executor.registerProvider('no-stream', providerWithoutStream);

            const request = {
                messages: [{ role: 'user' as const, content: 'Hello!', timestamp: new Date() }],
                provider: 'no-stream',
                model: 'test-model',
                stream: true as const
            };

            const streamGenerator = executor.executeChatStream(request);
            await expect(async () => {
                const iterator = streamGenerator[Symbol.asyncIterator]();
                await iterator.next();
            }).rejects.toThrow(
                'Provider "no-stream" does not implement chatStream method'
            );
        });
    });
}); 
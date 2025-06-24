import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationService } from './conversation-service';
import { UniversalMessage } from '../managers/conversation-history-manager';
import { AIProvider } from '../interfaces/provider';
import { ConversationContext, ConversationServiceOptions } from '../interfaces/service';
import { NetworkError, ProviderError } from '../utils/errors';

// Mock AI Provider for testing
class MockAIProvider implements AIProvider {
    name = 'mock-provider';
    models = ['mock-model'];

    supportsModel(model: string): boolean {
        return this.models.includes(model);
    }

    async generateResponse(request: any): Promise<any> {
        return {
            content: 'Mock response',
            usage: { totalTokens: 10, promptTokens: 5, completionTokens: 5 },
            finishReason: 'stop'
        };
    }

    async *generateStreamingResponse(request: any): AsyncGenerator<any, void, unknown> {
        yield { content: 'Mock ', isComplete: false };
        yield { content: 'streaming ', isComplete: false };
        yield { content: 'response', isComplete: true };
    }

    async chat(model: string, context: any, options?: any): Promise<any> {
        return this.generateResponse({ model, context, options });
    }

    async *chatStream(model: string, context: any, options?: any): AsyncGenerator<any, void, unknown> {
        yield* this.generateStreamingResponse({ model, context, options });
    }
}

describe('ConversationService', () => {
    let conversationService: ConversationService;
    let mockProvider: MockAIProvider;
    let mockMessages: UniversalMessage[];
    let baseContext: ConversationContext;

    beforeEach(() => {
        conversationService = new ConversationService();
        mockProvider = new MockAIProvider();

        mockMessages = [
            {
                role: 'system',
                content: 'You are a helpful assistant',
                timestamp: new Date(),
                metadata: {}
            },
            {
                role: 'user',
                content: 'Hello',
                timestamp: new Date(),
                metadata: {}
            }
        ];

        baseContext = {
            messages: mockMessages,
            model: 'mock-model',
            provider: 'mock-provider',
            systemMessage: 'You are a helpful assistant',
            temperature: 0.7,
            maxTokens: 1000
        };
    });

    describe('Stateless Implementation', () => {
        it('should not maintain internal state between calls', () => {
            const service1 = new ConversationService();
            const service2 = new ConversationService();

            // Both instances should behave identically
            const context1 = service1.prepareContext(mockMessages, 'model1', 'provider1');
            const context2 = service2.prepareContext(mockMessages, 'model1', 'provider1');

            expect(context1).toEqual(context2);
        });

        it('should produce consistent results for same inputs', () => {
            const messages = [...mockMessages];

            const context1 = conversationService.prepareContext(messages, 'test-model', 'test-provider');
            const context2 = conversationService.prepareContext(messages, 'test-model', 'test-provider');

            expect(context1).toEqual(context2);
        });

        it('should not mutate input messages', () => {
            const originalMessages = [...mockMessages];
            const messagesCopy = JSON.parse(JSON.stringify(mockMessages));

            conversationService.prepareContext(mockMessages, 'test-model', 'test-provider');

            expect(mockMessages).toEqual(originalMessages);
            expect(mockMessages).toEqual(messagesCopy);
        });
    });

    describe('Context Preparation (Pure Function)', () => {
        it('should create valid conversation context', () => {
            const context = conversationService.prepareContext(
                mockMessages,
                'test-model',
                'test-provider',
                { temperature: 0.8, maxTokens: 2000 }
            );

            expect(context.messages).toEqual(mockMessages);
            expect(context.model).toBe('test-model');
            expect(context.provider).toBe('test-provider');
            expect(context.temperature).toBe(0.8);
            expect(context.maxTokens).toBe(2000);
        });

        it('should apply default options', () => {
            const context = conversationService.prepareContext(
                mockMessages,
                'test-model',
                'test-provider'
            );

            expect(context.messages).toEqual(mockMessages);
            expect(context.model).toBe('test-model');
            expect(context.provider).toBe('test-provider');
        });

        it('should trim history when maxHistoryLength is set', () => {
            const longMessages: UniversalMessage[] = Array.from({ length: 10 }, (_, i) => ({
                role: 'user',
                content: `Message ${i}`,
                timestamp: new Date(),
                metadata: {}
            }));

            const context = conversationService.prepareContext(
                longMessages,
                'test-model',
                'test-provider',
                {},
                { maxHistoryLength: 5 }
            );

            expect(context.messages).toHaveLength(5);
            expect(context.messages[0].content).toBe('Message 5'); // Most recent 5
        });

        it('should preserve system messages when trimming', () => {
            const messagesWithSystem: UniversalMessage[] = [
                { role: 'system', content: 'System message', timestamp: new Date(), metadata: {} },
                ...Array.from({ length: 10 }, (_, i) => ({
                    role: 'user' as const,
                    content: `Message ${i}`,
                    timestamp: new Date(),
                    metadata: {}
                }))
            ];

            const context = conversationService.prepareContext(
                messagesWithSystem,
                'test-model',
                'test-provider',
                {},
                { maxHistoryLength: 5 }
            );

            expect(context.messages).toHaveLength(5);
            expect(context.messages[0].role).toBe('system');
            expect(context.messages[0].content).toBe('System message');
        });
    });

    describe('Response Generation', () => {
        it('should generate response successfully', async () => {
            const response = await conversationService.generateResponse(
                mockProvider,
                baseContext
            );

            expect(response.content).toBe('Mock response');
            expect(response.usage?.totalTokens).toBe(10);
            expect(response.finishReason).toBe('stop');
        });

        it('should handle provider errors and wrap them', async () => {
            const failingProvider = new MockAIProvider();
            failingProvider.generateResponse = async () => {
                throw new Error('Provider failed');
            };

            await expect(
                conversationService.generateResponse(failingProvider, baseContext)
            ).rejects.toThrow('Provider failed');
        });

        it('should apply retry logic on recoverable errors', async () => {
            let attemptCount = 0;
            const retryingProvider = new MockAIProvider();
            retryingProvider.generateResponse = async () => {
                attemptCount++;
                if (attemptCount < 3) {
                    throw new NetworkError('Network temporarily unavailable');
                }
                return { content: 'Success after retry' };
            };

            const response = await conversationService.generateResponse(
                retryingProvider,
                baseContext,
                { maxRetries: 3, enableRetry: true }
            );

            expect(response.content).toBe('Success after retry');
            expect(attemptCount).toBe(3);
        });

        it('should timeout long-running requests', async () => {
            const slowProvider = new MockAIProvider();
            slowProvider.generateResponse = async () => {
                await new Promise(resolve => setTimeout(resolve, 1000));
                return { content: 'Too slow' };
            };

            await expect(
                conversationService.generateResponse(
                    slowProvider,
                    baseContext,
                    { timeout: 100 }
                )
            ).rejects.toThrow();
        }, 2000);
    });

    describe('Streaming Response Generation', () => {
        it('should generate streaming response successfully', async () => {
            const chunks: any[] = [];

            for await (const chunk of conversationService.generateStreamingResponse(
                mockProvider,
                baseContext
            )) {
                chunks.push(chunk);
            }

            expect(chunks).toHaveLength(3);
            expect(chunks[0].content).toBe('Mock ');
            expect(chunks[0].isComplete).toBe(false);
            expect(chunks[2].content).toBe('response');
            expect(chunks[2].isComplete).toBe(true);
        });

        it('should handle streaming errors', async () => {
            const failingProvider = new MockAIProvider();
            failingProvider.generateStreamingResponse = async function* () {
                throw new Error('Streaming failed');
            };

            const generator = conversationService.generateStreamingResponse(
                failingProvider,
                baseContext
            );

            await expect(generator.next()).rejects.toThrow('Streaming failed');
        });

        it('should apply streaming-specific options', async () => {
            const chunks: any[] = [];

            for await (const chunk of conversationService.generateStreamingResponse(
                mockProvider,
                baseContext,
                { timeout: 5000 }
            )) {
                chunks.push(chunk);
            }

            expect(chunks.length).toBeGreaterThan(0);
        });
    });

    describe('Context Validation', () => {
        it('should validate valid context', () => {
            const validation = conversationService.validateContext(baseContext);

            expect(validation.isValid).toBe(true);
            expect(validation.errors).toHaveLength(0);
        });

        it('should reject empty messages', () => {
            const invalidContext = {
                ...baseContext,
                messages: []
            };

            const validation = conversationService.validateContext(invalidContext);

            expect(validation.isValid).toBe(false);
            expect(validation.errors).toContain('Messages array cannot be empty');
        });

        it('should reject empty model name', () => {
            const invalidContext = {
                ...baseContext,
                model: ''
            };

            const validation = conversationService.validateContext(invalidContext);

            expect(validation.isValid).toBe(false);
            expect(validation.errors).toContain('Model name cannot be empty');
        });

        it('should reject empty provider name', () => {
            const invalidContext = {
                ...baseContext,
                provider: ''
            };

            const validation = conversationService.validateContext(invalidContext);

            expect(validation.isValid).toBe(false);
            expect(validation.errors).toContain('Provider name cannot be empty');
        });

        it('should validate temperature range', () => {
            const invalidContext = {
                ...baseContext,
                temperature: 3.0
            };

            const validation = conversationService.validateContext(invalidContext);

            expect(validation.isValid).toBe(false);
            expect(validation.errors.some(e => e.includes('temperature'))).toBe(true);
        });

        it('should validate maxTokens positive value', () => {
            const invalidContext = {
                ...baseContext,
                maxTokens: -100
            };

            const validation = conversationService.validateContext(invalidContext);

            expect(validation.isValid).toBe(false);
            expect(validation.errors.some(e => e.includes('maxTokens'))).toBe(true);
        });
    });

    describe('Message Creation Utilities', () => {
        it('should create user messages correctly', () => {
            const userMessage = conversationService.createUserMessage(
                'Hello world',
                { userId: 'test-user' }
            );

            expect(userMessage.role).toBe('user');
            expect(userMessage.content).toBe('Hello world');
            expect(userMessage.metadata?.userId).toBe('test-user');
            expect(userMessage.timestamp).toBeInstanceOf(Date);
        });

        it('should create assistant messages from response', () => {
            const mockResponse = {
                content: 'Assistant response',
                usage: { totalTokens: 20 },
                finishReason: 'stop'
            };

            const assistantMessage = conversationService.createAssistantMessage(
                mockResponse,
                { responseId: 'test-response' }
            );

            expect(assistantMessage.role).toBe('assistant');
            expect(assistantMessage.content).toBe('Assistant response');
            expect(assistantMessage.metadata?.responseId).toBe('test-response');
        });

        it('should create system messages correctly', () => {
            const systemMessage = conversationService.createSystemMessage(
                'You are a helpful assistant',
                { systemLevel: 'high' }
            );

            expect(systemMessage.role).toBe('system');
            expect(systemMessage.content).toBe('You are a helpful assistant');
            expect(systemMessage.metadata?.systemLevel).toBe('high');
        });

        it('should create tool messages correctly', () => {
            const toolMessage = conversationService.createToolMessage(
                'tool-call-123',
                { result: 'success' },
                { toolExecution: 'test' }
            );

            expect(toolMessage.role).toBe('tool');
            expect(toolMessage.toolCallId).toBe('tool-call-123');
            expect(toolMessage.content).toBe('{"result":"success"}');
            expect(toolMessage.metadata?.toolExecution).toBe('test');
        });
    });

    describe('Error Handling and Recovery', () => {
        it('should properly categorize and handle different error types', async () => {
            const providers = {
                networkError: new MockAIProvider(),
                providerError: new MockAIProvider(),
                unknownError: new MockAIProvider()
            };

            providers.networkError.generateResponse = async () => {
                throw new NetworkError('Connection failed');
            };

            providers.providerError.generateResponse = async () => {
                throw new ProviderError('API limit exceeded', 'test-provider');
            };

            providers.unknownError.generateResponse = async () => {
                throw new Error('Unknown error');
            };

            // Network errors should be retried
            await expect(
                conversationService.generateResponse(providers.networkError, baseContext, { enableRetry: true })
            ).rejects.toThrow(NetworkError);

            // Provider errors should be retried
            await expect(
                conversationService.generateResponse(providers.providerError, baseContext, { enableRetry: true })
            ).rejects.toThrow(ProviderError);

            // Unknown errors should be wrapped
            await expect(
                conversationService.generateResponse(providers.unknownError, baseContext, { enableRetry: false })
            ).rejects.toThrow();
        });

        it('should respect retry limits', async () => {
            let attemptCount = 0;
            const alwaysFailingProvider = new MockAIProvider();
            alwaysFailingProvider.generateResponse = async () => {
                attemptCount++;
                throw new NetworkError('Always fails');
            };

            await expect(
                conversationService.generateResponse(
                    alwaysFailingProvider,
                    baseContext,
                    { enableRetry: true, maxRetries: 2 }
                )
            ).rejects.toThrow(NetworkError);

            expect(attemptCount).toBe(3); // Initial attempt + 2 retries
        });
    });
}); 
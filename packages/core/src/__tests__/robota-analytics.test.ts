import { describe, it, expect, beforeEach } from 'vitest';
import { Robota } from '../robota';
import type { AIProvider, Context, ModelResponse, StreamingResponseChunk } from '../interfaces/ai-provider';

// Mock AI Provider for testing
class MockAIProvider implements AIProvider {
    public name: string = 'mock';
    private responseTokens: number;

    constructor(responseTokens: number = 50) {
        this.responseTokens = responseTokens;
    }

    async chat(model: string, context: Context, options?: any): Promise<ModelResponse> {
        return {
            content: `Mock response from ${this.name} using ${model}`,
            usage: {
                promptTokens: 20,
                completionTokens: this.responseTokens - 20,
                totalTokens: this.responseTokens
            }
        };
    }

    async *chatStream(model: string, context: Context, options?: any): AsyncGenerator<StreamingResponseChunk, void, unknown> {
        yield {
            content: `Mock streaming response from ${this.name} using ${model}`,
            isComplete: true
        };
    }

    async close(): Promise<void> {
        // Mock implementation
    }
}

describe('Robota Analytics Integration', () => {
    let robota: Robota;
    let mockProvider: MockAIProvider;

    beforeEach(() => {
        mockProvider = new MockAIProvider(100);
        robota = new Robota({
            aiProviders: { mock: mockProvider },
            currentProvider: 'mock',
            currentModel: 'mock-model',
            systemPrompt: 'You are a test assistant.',
            maxTokenLimit: 500
        });
    });

    describe('Analytics Functionality', () => {
        it('should track analytics for execute method', async () => {
            // Check initial state
            expect(robota.getRequestCount()).toBe(0);
            expect(robota.getTotalTokensUsed()).toBe(0);

            // Execute a request
            const response = await robota.execute('Hello, world!');

            // Check analytics were updated
            expect(robota.getRequestCount()).toBe(1);
            expect(robota.getTotalTokensUsed()).toBe(100);
            expect(response).toBe('Mock response from mock using mock-model');

            // Execute another request
            await robota.execute('How are you?');

            // Check cumulative analytics
            expect(robota.getRequestCount()).toBe(2);
            expect(robota.getTotalTokensUsed()).toBe(200);
        });

        it('should track analytics for chat method', async () => {
            await robota.chat('Hello, world!');
            expect(robota.getRequestCount()).toBe(1);
            expect(robota.getTotalTokensUsed()).toBe(100);

            await robota.chat('How are you?');
            expect(robota.getRequestCount()).toBe(2);
            expect(robota.getTotalTokensUsed()).toBe(200);
        });

        it('should provide detailed analytics', async () => {
            await robota.execute('Test message');

            const analytics = robota.getAnalytics();

            expect(analytics).toEqual({
                requestCount: 1,
                totalTokensUsed: 100,
                averageTokensPerRequest: 100,
                tokenUsageHistory: [
                    expect.objectContaining({
                        tokens: 100,
                        provider: 'mock',
                        model: 'mock-model',
                        timestamp: expect.any(Date)
                    })
                ]
            });
        });

        it('should support analytics reset', async () => {
            await robota.execute('Test message 1');
            await robota.execute('Test message 2');

            expect(robota.getRequestCount()).toBe(2);
            expect(robota.getTotalTokensUsed()).toBe(200);

            robota.resetAnalytics();

            expect(robota.getRequestCount()).toBe(0);
            expect(robota.getTotalTokensUsed()).toBe(0);
            expect(robota.getAnalytics().tokenUsageHistory).toHaveLength(0);
        });

        it('should support token usage by period', async () => {
            const startTime = new Date();
            await robota.execute('Test message');

            // Get usage from just before the request to now
            const beforeRequest = new Date(startTime.getTime() - 1000);
            const afterRequest = new Date();

            const periodUsage = robota.getTokenUsageByPeriod(beforeRequest, afterRequest);

            expect(periodUsage.totalTokens).toBe(100);
            expect(periodUsage.requestCount).toBe(1);
            expect(periodUsage.usageHistory).toHaveLength(1);
        });
    });

    describe('Token Limit Enforcement', () => {
        it('should enforce max token limit', async () => {
            // Set a lower token limit
            robota.setMaxTokenLimit(150);

            // First request should succeed
            await robota.execute('First message');
            expect(robota.getTotalTokensUsed()).toBe(100);

            // Second request should fail due to token limit
            await expect(robota.execute('Second message')).rejects.toThrow(
                'Token limit exceeded. Current usage: 100, attempting to add: 100, limit: 150'
            );

            // Should not have recorded the failed request
            expect(robota.getRequestCount()).toBe(1);
            expect(robota.getTotalTokensUsed()).toBe(100);
        });

        it('should get and set max token limit', () => {
            expect(robota.getMaxTokenLimit()).toBe(500);

            robota.setMaxTokenLimit(1000);
            expect(robota.getMaxTokenLimit()).toBe(1000);
        });

        it('should work without token limit', async () => {
            // Create robota without token limit (set to unlimited)
            const unlimitedRobota = new Robota({
                aiProviders: { mock: mockProvider },
                currentProvider: 'mock',
                currentModel: 'mock-model',
                maxTokenLimit: 0  // 0 means unlimited
            });

            expect(unlimitedRobota.getMaxTokenLimit()).toBe(0);  // 0 means unlimited

            // Should work fine without limit
            await unlimitedRobota.execute('Test message');
            expect(unlimitedRobota.getTotalTokensUsed()).toBe(100);

            const limitInfo = unlimitedRobota.getLimitInfo();
            expect(limitInfo.maxTokens).toBe(0);
            expect(limitInfo.remainingTokens).toBeUndefined();
        });
    });

    describe('Method Deprecation and Renaming', () => {
        it('should show deprecation warning for run method', async () => {
            const logSpy = {
                warn: (message: string) => {
                    expect(message).toContain('run() method is deprecated. Use execute() instead.');
                },
                error: () => { },
                info: () => { },
                debug: () => { }
            };

            const debugRobota = new Robota({
                aiProviders: { mock: mockProvider },
                currentProvider: 'mock',
                currentModel: 'mock-model',
                debug: true,
                logger: logSpy as any
            });

            const response = await debugRobota.run('Test message');
            expect(response).toBe('Mock response from mock using mock-model');
        });

        it('should show deprecation warning for runStream method', async () => {
            let warningCalled = false;
            const logSpy = {
                warn: (message: string) => {
                    expect(message).toContain('runStream() method is deprecated. Use executeStream() instead.');
                    warningCalled = true;
                },
                error: () => { },
                info: () => { },
                debug: () => { }
            };

            const debugRobota = new Robota({
                aiProviders: { mock: mockProvider },
                currentProvider: 'mock',
                currentModel: 'mock-model',
                debug: true,
                logger: logSpy as any
            });

            const stream = await debugRobota.runStream('Test message');
            expect(stream).toBeDefined();
            expect(warningCalled).toBe(true);
        });

        it('should execute method work the same as deprecated run method', async () => {
            const executeResponse = await robota.execute('Test message');

            // Reset analytics to compare
            robota.resetAnalytics();

            const runResponse = await robota.run('Test message');

            expect(executeResponse).toBe(runResponse);
            expect(robota.getRequestCount()).toBe(1); // Should track the same way
        });
    });

    describe('Analytics with Different Providers', () => {
        it('should track analytics per provider and model', async () => {
            const secondProvider = new MockAIProvider(75);
            robota.addAIProvider('second', secondProvider);

            // Execute with first provider
            await robota.execute('Message 1');

            // Switch to second provider
            robota.setCurrentAI('second', 'second-model');
            await robota.execute('Message 2');

            const analytics = robota.getAnalytics();
            expect(analytics.requestCount).toBe(2);
            expect(analytics.totalTokensUsed).toBe(175);

            expect(analytics.tokenUsageHistory).toEqual([
                expect.objectContaining({
                    tokens: 100,
                    provider: 'mock',
                    model: 'mock-model'
                }),
                expect.objectContaining({
                    tokens: 75,
                    provider: 'second',
                    model: 'second-model'
                })
            ]);
        });
    });

    describe('Error Handling', () => {
        it('should handle requests with missing usage data', async () => {
            // Create a provider that doesn't return usage data
            const noUsageProvider: AIProvider = {
                name: 'no-usage',
                async chat(): Promise<ModelResponse> {
                    return {
                        content: 'Response without usage data'
                        // No usage field
                    };
                },
                async close(): Promise<void> { }
            };

            const noUsageRobota = new Robota({
                aiProviders: { noUsage: noUsageProvider },
                currentProvider: 'noUsage',
                currentModel: 'test'
            });

            await noUsageRobota.execute('Test message');

            // Should not have recorded any token usage
            expect(noUsageRobota.getRequestCount()).toBe(0);
            expect(noUsageRobota.getTotalTokensUsed()).toBe(0);
        });
    });

    describe('Pre-request Token Estimation', () => {
        it('should calculate tokens before making request and allow within limit', async () => {
            robota.setMaxTokenLimit(1000);

            const response = await robota.execute('Hello, world!');

            expect(response).toBe('Mock response from mock using mock-model');
            expect(robota.getRequestCount()).toBe(1);
            expect(robota.getTotalTokensUsed()).toBe(100);
        });

        it('should prevent request if estimated tokens would exceed limit', async () => {
            // Set a very low token limit
            robota.setMaxTokenLimit(10);

            // This should fail before making the actual API call
            await expect(robota.execute('Hello, world! This is a longer message that should definitely exceed our very low token limit of 10 tokens.')).rejects.toThrow(
                /Estimated token limit would be exceeded/
            );

            // Should not have made any requests or recorded any usage
            expect(robota.getRequestCount()).toBe(0);
            expect(robota.getTotalTokensUsed()).toBe(0);
        });

        it('should prevent chat request if estimated tokens would exceed limit', async () => {
            robota.setMaxTokenLimit(10);

            await expect(robota.chat('This is a message that should exceed the token limit')).rejects.toThrow(
                /Estimated token limit would be exceeded/
            );

            expect(robota.getRequestCount()).toBe(0);
            expect(robota.getTotalTokensUsed()).toBe(0);
        });

        it('should show token estimation in debug mode', async () => {
            const logMessages: string[] = [];
            const debugLogger = {
                info: (message: string) => {
                    logMessages.push(message);
                },
                error: () => { },
                warn: () => { },
                debug: () => { }
            };

            const debugRobota = new Robota({
                aiProviders: { mock: mockProvider },
                currentProvider: 'mock',
                currentModel: 'mock-model',
                debug: true,
                logger: debugLogger,
                maxTokenLimit: 1000
            });

            await debugRobota.execute('Hello, world!');

            // Should have logged token estimation
            expect(logMessages.some(msg => msg.includes('Token Estimation'))).toBe(true);
            expect(logMessages.some(msg => msg.includes('Estimated tokens:'))).toBe(true);
        });

        it('should not check tokens if no limit is set', async () => {
            // Create robota without token limit
            const unlimitedRobota = new Robota({
                aiProviders: { mock: mockProvider },
                currentProvider: 'mock',
                currentModel: 'mock-model'
            });

            // Should work fine even with a very long message
            const longMessage = 'This is a very long message that would normally exceed token limits but should work fine when no limit is set. '.repeat(100);

            const response = await unlimitedRobota.execute(longMessage);
            expect(response).toBe('Mock response from mock using mock-model');
        });

        it('should handle token calculation errors gracefully', async () => {
            // Create a robota with an invalid model name to potentially trigger tiktoken errors
            const errorRobota = new Robota({
                aiProviders: { mock: mockProvider },
                currentProvider: 'mock',
                currentModel: 'unknown-model-that-might-cause-tiktoken-error',
                maxTokenLimit: 1000,
                debug: false
            });

            // Should still work due to fallback estimation
            const response = await errorRobota.execute('Hello, world!');
            expect(response).toBe('Mock response from mock using unknown-model-that-might-cause-tiktoken-error');
        });
    });
}); 
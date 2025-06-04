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

    async chat(model: string, _context: Context, _options?: any): Promise<ModelResponse> {
        return {
            content: `Mock response from ${this.name} using ${model}`,
            usage: {
                promptTokens: 20,
                completionTokens: this.responseTokens - 20,
                totalTokens: this.responseTokens
            }
        };
    }

    async *chatStream(model: string, _context: Context, _options?: any): AsyncGenerator<StreamingResponseChunk, void, unknown> {
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
            robota.setMaxTokenLimit(150);

            await robota.execute('First message');
            expect(robota.getTotalTokensUsed()).toBe(100);

            // This should fail (150 total limit, 100 used, 100 needed = 200 > 150)
            await expect(robota.execute('Second message')).rejects.toThrow(/Token limit exceeded/);

            // Should not have recorded the failed request
            expect(robota.getRequestCount()).toBe(1);
            expect(robota.getTotalTokensUsed()).toBe(100);
        });

        it('should get and set max token limit', async () => {
            // Reset first to ensure clean state
            robota.setMaxTokenLimit(4096);
            expect(robota.getMaxTokenLimit()).toBe(4096); // Default value

            robota.setMaxTokenLimit(500);
            expect(robota.getMaxTokenLimit()).toBe(500);

            robota.setMaxTokenLimit(0); // Unlimited
            expect(robota.getMaxTokenLimit()).toBe(0);
        });

        it('should work without token limit', async () => {
            const unlimitedRobota = new Robota({
                aiProviders: { mock: mockProvider },
                currentProvider: 'mock',
                currentModel: 'mock-model',
                maxTokenLimit: 0
            });

            // Should work fine without limits
            await unlimitedRobota.execute('Message 1');
            await unlimitedRobota.execute('Message 2');
            await unlimitedRobota.execute('Message 3');

            expect(unlimitedRobota.getTotalTokensUsed()).toBe(300);

            const limitInfo = unlimitedRobota.getLimitInfo();
            expect(limitInfo.maxTokens).toBe(0);
            expect(limitInfo.remainingTokens).toBeUndefined();
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
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

describe('Robota Refactored Architecture', () => {
    let robota: Robota;
    let mockProvider: MockAIProvider;

    beforeEach(() => {
        mockProvider = new MockAIProvider(100);
        robota = new Robota({
            aiProviders: { mock: mockProvider },
            currentProvider: 'mock',
            currentModel: 'mock-model',
            systemPrompt: 'You are a test assistant.'
        });
    });

    describe('Default Configuration', () => {
        it('should initialize with default limits (4096 tokens, 25 requests)', () => {
            expect(robota.getMaxTokenLimit()).toBe(4096);
            expect(robota.getMaxRequestLimit()).toBe(25);

            const limitInfo = robota.getLimitInfo();
            expect(limitInfo.maxTokens).toBe(4096);
            expect(limitInfo.maxRequests).toBe(25);
            expect(limitInfo.currentTokensUsed).toBe(0);
            expect(limitInfo.currentRequestCount).toBe(0);
            expect(limitInfo.remainingTokens).toBe(4096);
            expect(limitInfo.remainingRequests).toBe(25);
            expect(limitInfo.isTokensUnlimited).toBe(false);
            expect(limitInfo.isRequestsUnlimited).toBe(false);
        });

        it('should support custom limits in constructor', () => {
            const customRobota = new Robota({
                aiProviders: { mock: mockProvider },
                currentProvider: 'mock',
                currentModel: 'mock-model',
                maxTokenLimit: 2000,
                maxRequestLimit: 10
            });

            expect(customRobota.getMaxTokenLimit()).toBe(2000);
            expect(customRobota.getMaxRequestLimit()).toBe(10);

            const limitInfo = customRobota.getLimitInfo();
            expect(limitInfo.maxTokens).toBe(2000);
            expect(limitInfo.maxRequests).toBe(10);
            expect(limitInfo.remainingTokens).toBe(2000);
            expect(limitInfo.remainingRequests).toBe(10);
        });

        it('should support unlimited configuration (0 values)', () => {
            const unlimitedRobota = new Robota({
                aiProviders: { mock: mockProvider },
                currentProvider: 'mock',
                currentModel: 'mock-model',
                maxTokenLimit: 0,
                maxRequestLimit: 0
            });

            const limitInfo = unlimitedRobota.getLimitInfo();
            expect(limitInfo.maxTokens).toBe(0);
            expect(limitInfo.maxRequests).toBe(0);
            expect(limitInfo.isTokensUnlimited).toBe(true);
            expect(limitInfo.isRequestsUnlimited).toBe(true);
            expect(limitInfo.remainingTokens).toBeUndefined();
            expect(limitInfo.remainingRequests).toBeUndefined();
        });
    });

    describe('Request Limit Management', () => {
        it('should enforce request limits', async () => {
            robota.setMaxRequestLimit(2);

            // First two requests should succeed
            await robota.execute('Message 1');
            await robota.execute('Message 2');

            const limitInfo = robota.getLimitInfo();
            expect(limitInfo.currentRequestCount).toBe(2);
            expect(limitInfo.remainingRequests).toBe(0);

            // Third request should fail
            await expect(robota.execute('Message 3')).rejects.toThrow(
                'Request limit exceeded. Current requests: 2, limit: 2'
            );

            // Verify the failed request wasn't counted
            const finalInfo = robota.getLimitInfo();
            expect(finalInfo.currentRequestCount).toBe(2);
        });

        it('should enforce token limits', async () => {
            robota.setMaxTokenLimit(150);

            // First request should succeed (100 tokens)
            await robota.execute('Message 1');

            const limitInfo = robota.getLimitInfo();
            expect(limitInfo.currentTokensUsed).toBe(100);
            expect(limitInfo.remainingTokens).toBe(50);

            // Second request should fail (would exceed 150 tokens)
            await expect(robota.execute('Message 2')).rejects.toThrow(
                'Token limit exceeded'
            );

            // Verify the failed request wasn't counted
            const finalInfo = robota.getLimitInfo();
            expect(finalInfo.currentTokensUsed).toBe(100);
            expect(finalInfo.currentRequestCount).toBe(1);
        });

        it('should support dynamic limit changes', () => {
            robota.setMaxTokenLimit(2000);
            robota.setMaxRequestLimit(50);

            expect(robota.getMaxTokenLimit()).toBe(2000);
            expect(robota.getMaxRequestLimit()).toBe(50);

            const limitInfo = robota.getLimitInfo();
            expect(limitInfo.maxTokens).toBe(2000);
            expect(limitInfo.maxRequests).toBe(50);
        });

        it('should handle unlimited mode correctly', async () => {
            robota.setMaxTokenLimit(0);
            robota.setMaxRequestLimit(0);

            // Should be able to make many requests without limits
            for (let i = 0; i < 30; i++) {
                await robota.execute(`Message ${i}`);
            }

            const limitInfo = robota.getLimitInfo();
            expect(limitInfo.currentRequestCount).toBe(30);
            expect(limitInfo.currentTokensUsed).toBe(3000);
            expect(limitInfo.isTokensUnlimited).toBe(true);
            expect(limitInfo.isRequestsUnlimited).toBe(true);
            expect(limitInfo.remainingTokens).toBeUndefined();
            expect(limitInfo.remainingRequests).toBeUndefined();
        });
    });

    describe('Pre-request Token Estimation', () => {
        it('should calculate and validate tokens before API calls', async () => {
            const debugLogger = {
                info: (message: string) => {
                    if (message.includes('Token Estimation')) {
                        expect(message).toContain('Estimated tokens:');
                    }
                },
                error: console.error,
                warn: console.warn,
                debug: console.debug
            };

            const debugRobota = new Robota({
                aiProviders: { mock: mockProvider },
                currentProvider: 'mock',
                currentModel: 'mock-model',
                debug: true,
                logger: debugLogger,
                maxTokenLimit: 1000
            });

            const response = await debugRobota.execute('Hello, world!');
            expect(response).toBe('Mock response from mock using mock-model');
        });

        it('should prevent costly API calls when tokens would exceed limit', async () => {
            robota.setMaxTokenLimit(10);

            // This should fail before making the API call due to token estimation
            await expect(robota.execute('This is a long message that will definitely exceed the very low token limit')).rejects.toThrow(
                /Estimated token limit would be exceeded/
            );

            // No API call should have been made, so no usage recorded
            const limitInfo = robota.getLimitInfo();
            expect(limitInfo.currentRequestCount).toBe(0);
            expect(limitInfo.currentTokensUsed).toBe(0);
        });

        it('should skip token estimation when unlimited', async () => {
            robota.setMaxTokenLimit(0);

            // Should work even with a very long message
            const longMessage = 'Very long message '.repeat(100);
            const response = await robota.execute(longMessage);

            expect(response).toBe('Mock response from mock using mock-model');
        });
    });

    describe('Separated Analytics', () => {
        it('should track pure analytics data', async () => {
            await robota.execute('Message 1');
            await robota.execute('Message 2');

            const analytics = robota.getAnalytics();
            expect(analytics.requestCount).toBe(2);
            expect(analytics.totalTokensUsed).toBe(200);
            expect(analytics.averageTokensPerRequest).toBe(100);
            expect(analytics.tokenUsageHistory).toHaveLength(2);

            // Analytics should not include limit information
            expect(analytics).not.toHaveProperty('maxTokenLimit');
            expect(analytics).not.toHaveProperty('remainingTokens');
        });

        it('should track usage by time period', async () => {
            const startTime = new Date();
            await robota.execute('Message 1');

            // Small delay
            await new Promise(resolve => setTimeout(resolve, 10));
            const midTime = new Date();

            await robota.execute('Message 2');

            const periodUsage = robota.getTokenUsageByPeriod(midTime);
            expect(periodUsage.requestCount).toBe(1);
            expect(periodUsage.totalTokens).toBe(100);
        });

        it('should reset analytics and limits together', async () => {
            await robota.execute('Message 1');
            await robota.execute('Message 2');

            robota.resetAnalytics();

            // Both analytics and limits should be reset
            expect(robota.getRequestCount()).toBe(0);
            expect(robota.getTotalTokensUsed()).toBe(0);

            const limitInfo = robota.getLimitInfo();
            expect(limitInfo.currentRequestCount).toBe(0);
            expect(limitInfo.currentTokensUsed).toBe(0);

            // But limits themselves should remain
            expect(limitInfo.maxTokens).toBe(4096);
            expect(limitInfo.maxRequests).toBe(25);
        });
    });

    describe('Complex Scenarios', () => {
        it('should handle mixed request and token limits correctly', async () => {
            robota.setMaxTokenLimit(350); // Allow 3-4 requests worth of tokens
            robota.setMaxRequestLimit(5);  // Allow up to 5 requests

            // First three requests should succeed (300 tokens total)
            await robota.execute('Message 1');
            await robota.execute('Message 2');
            await robota.execute('Message 3');

            const midInfo = robota.getLimitInfo();
            expect(midInfo.currentRequestCount).toBe(3);
            expect(midInfo.currentTokensUsed).toBe(300);
            expect(midInfo.remainingRequests).toBe(2);
            expect(midInfo.remainingTokens).toBe(50);

            // Fourth request should fail due to token limit (300 + 100 > 350)
            await expect(robota.execute('Message 4')).rejects.toThrow(
                /Token limit|Estimated token limit would be exceeded/
            );

            // Verify that request limit is still intact
            const finalInfo = robota.getLimitInfo();
            expect(finalInfo.currentRequestCount).toBe(3);
            expect(finalInfo.remainingRequests).toBe(2);
        });

        it('should handle provider switches correctly', async () => {
            const secondProvider = new MockAIProvider(75);
            robota.addAIProvider('second', secondProvider);

            // Execute with first provider
            await robota.execute('Message 1');

            // Switch to second provider and execute
            robota.setCurrentAI('second', 'second-model');
            await robota.execute('Message 2');

            // Check analytics
            const analytics = robota.getAnalytics();
            expect(analytics.requestCount).toBe(2);
            expect(analytics.totalTokensUsed).toBe(175); // 100 + 75
            expect(analytics.tokenUsageHistory).toEqual([
                expect.objectContaining({ provider: 'mock', model: 'mock-model', tokens: 100 }),
                expect.objectContaining({ provider: 'second', model: 'second-model', tokens: 75 })
            ]);

            // Check limits
            const limitInfo = robota.getLimitInfo();
            expect(limitInfo.currentRequestCount).toBe(2);
            expect(limitInfo.currentTokensUsed).toBe(175);
        });

        it('should maintain consistency between analytics and limits', async () => {
            await robota.execute('Message 1');
            await robota.execute('Message 2');

            const analytics = robota.getAnalytics();
            const limitInfo = robota.getLimitInfo();

            // These should always match
            expect(analytics.requestCount).toBe(limitInfo.currentRequestCount);
            expect(analytics.totalTokensUsed).toBe(limitInfo.currentTokensUsed);
        });
    });

    describe('Backward Compatibility', () => {
        it('should maintain deprecated method functionality', async () => {
            const response = await robota.run('Test message');
            expect(response).toBe('Mock response from mock using mock-model');

            // Should count toward limits the same as execute()
            const limitInfo = robota.getLimitInfo();
            expect(limitInfo.currentRequestCount).toBe(1);
            expect(limitInfo.currentTokensUsed).toBe(100);
        });

        it('should provide deprecation warnings in debug mode', async () => {
            let warningReceived = false;
            const debugLogger = {
                warn: (message: string) => {
                    if (message.includes('deprecated')) {
                        warningReceived = true;
                    }
                },
                error: console.error,
                info: console.info,
                debug: console.debug
            };

            const debugRobota = new Robota({
                aiProviders: { mock: mockProvider },
                currentProvider: 'mock',
                currentModel: 'mock-model',
                debug: true,
                logger: debugLogger
            });

            await debugRobota.run('Test message');
            expect(warningReceived).toBe(true);
        });
    });

    describe('Error Handling', () => {
        it('should handle API providers without usage data gracefully', async () => {
            const noUsageProvider: AIProvider = {
                name: 'no-usage',
                async chat(): Promise<ModelResponse> {
                    return { content: 'Response without usage data' };
                },
                async close(): Promise<void> { }
            };

            const testRobota = new Robota({
                aiProviders: { noUsage: noUsageProvider },
                currentProvider: 'noUsage',
                currentModel: 'test'
            });

            await testRobota.execute('Test message');

            // Should not record anything without usage data
            expect(testRobota.getRequestCount()).toBe(0);
            expect(testRobota.getTotalTokensUsed()).toBe(0);

            const limitInfo = testRobota.getLimitInfo();
            expect(limitInfo.currentRequestCount).toBe(0);
            expect(limitInfo.currentTokensUsed).toBe(0);
        });

        it('should handle invalid limit values', () => {
            expect(() => robota.setMaxTokenLimit(-100)).toThrow('Max token limit cannot be negative');
            expect(() => robota.setMaxRequestLimit(-10)).toThrow('Max request limit cannot be negative');
        });
    });
}); 
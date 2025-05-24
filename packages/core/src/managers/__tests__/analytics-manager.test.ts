import { describe, it, expect, beforeEach } from 'vitest';
import { AnalyticsManager } from '../analytics-manager';

describe('AnalyticsManager', () => {
    let analyticsManager: AnalyticsManager;

    beforeEach(() => {
        analyticsManager = new AnalyticsManager();
    });

    describe('Request and Token Tracking', () => {
        it('should track request count', () => {
            expect(analyticsManager.getRequestCount()).toBe(0);

            analyticsManager.recordRequest(10, 'openai', 'gpt-4');
            expect(analyticsManager.getRequestCount()).toBe(1);

            analyticsManager.recordRequest(20, 'anthropic', 'claude-3');
            expect(analyticsManager.getRequestCount()).toBe(2);
        });

        it('should track total token usage', () => {
            expect(analyticsManager.getTotalTokensUsed()).toBe(0);

            analyticsManager.recordRequest(10, 'openai', 'gpt-4');
            expect(analyticsManager.getTotalTokensUsed()).toBe(10);

            analyticsManager.recordRequest(25, 'anthropic', 'claude-3');
            expect(analyticsManager.getTotalTokensUsed()).toBe(35);
        });

        it('should record request with provider and model information', () => {
            const beforeTime = new Date();
            analyticsManager.recordRequest(50, 'openai', 'gpt-4');
            const afterTime = new Date();

            const analytics = analyticsManager.getAnalytics();
            expect(analytics.tokenUsageHistory).toHaveLength(1);

            const entry = analytics.tokenUsageHistory[0];
            expect(entry.tokens).toBe(50);
            expect(entry.provider).toBe('openai');
            expect(entry.model).toBe('gpt-4');
            expect(entry.timestamp.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
            expect(entry.timestamp.getTime()).toBeLessThanOrEqual(afterTime.getTime());
        });
    });

    describe('Analytics Data', () => {
        it('should return comprehensive analytics data', () => {
            analyticsManager.recordRequest(30, 'openai', 'gpt-4');
            analyticsManager.recordRequest(20, 'anthropic', 'claude-3');

            const analytics = analyticsManager.getAnalytics();

            expect(analytics).toEqual({
                requestCount: 2,
                totalTokensUsed: 50,
                averageTokensPerRequest: 25,
                tokenUsageHistory: expect.arrayContaining([
                    expect.objectContaining({
                        tokens: 30,
                        provider: 'openai',
                        model: 'gpt-4'
                    }),
                    expect.objectContaining({
                        tokens: 20,
                        provider: 'anthropic',
                        model: 'claude-3'
                    })
                ])
            });
        });

        it('should calculate average tokens per request correctly', () => {
            analyticsManager.recordRequest(10, 'openai', 'gpt-4');
            analyticsManager.recordRequest(20, 'openai', 'gpt-4');
            analyticsManager.recordRequest(30, 'openai', 'gpt-4');

            const analytics = analyticsManager.getAnalytics();
            expect(analytics.averageTokensPerRequest).toBe(20);
        });

        it('should handle zero requests for average calculation', () => {
            const analytics = analyticsManager.getAnalytics();
            expect(analytics.averageTokensPerRequest).toBe(0);
        });
    });

    describe('Token Usage by Period', () => {
        it('should filter token usage by date range', async () => {
            // Create test entries with small delays
            const testManager = new AnalyticsManager();

            testManager.recordRequest(10, 'openai', 'gpt-4');

            // Small delay to ensure different timestamps
            await new Promise(resolve => setTimeout(resolve, 10));
            const filterMidDate = new Date();

            testManager.recordRequest(20, 'anthropic', 'claude-3');

            await new Promise(resolve => setTimeout(resolve, 10));
            const filterEndDate = new Date();

            testManager.recordRequest(30, 'google', 'gemini');

            // Filter for the middle request only
            const periodUsage = testManager.getTokenUsageByPeriod(filterMidDate, filterEndDate);

            expect(periodUsage.totalTokens).toBeGreaterThanOrEqual(20);
            expect(periodUsage.requestCount).toBeGreaterThanOrEqual(1);
            expect(periodUsage.usageHistory.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('Reset Functionality', () => {
        it('should reset all analytics data', () => {
            analyticsManager.recordRequest(50, 'openai', 'gpt-4');
            analyticsManager.recordRequest(25, 'anthropic', 'claude-3');

            analyticsManager.reset();

            expect(analyticsManager.getRequestCount()).toBe(0);
            expect(analyticsManager.getTotalTokensUsed()).toBe(0);
            expect(analyticsManager.getAnalytics().tokenUsageHistory).toHaveLength(0);
        });
    });
}); 
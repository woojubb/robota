import { describe, it, expect, beforeEach } from 'vitest';
import { RequestLimitManager } from '../request-limit-manager';

describe('RequestLimitManager', () => {
    let requestLimitManager: RequestLimitManager;

    beforeEach(() => {
        requestLimitManager = new RequestLimitManager();
    });

    describe('Initialization and Default Values', () => {
        it('should initialize with default values', () => {
            expect(requestLimitManager.getMaxTokens()).toBe(4096);
            expect(requestLimitManager.getMaxRequests()).toBe(25);
        });

        it('should initialize with custom values', () => {
            const customManager = new RequestLimitManager(1000, 10);
            expect(customManager.getMaxTokens()).toBe(1000);
            expect(customManager.getMaxRequests()).toBe(10);
        });

        it('should support unlimited values (0)', () => {
            const unlimitedManager = new RequestLimitManager(0, 0);
            expect(unlimitedManager.getMaxTokens()).toBe(0);
            expect(unlimitedManager.getMaxRequests()).toBe(0);
            expect(unlimitedManager.isTokensUnlimited()).toBe(true);
            expect(unlimitedManager.isRequestsUnlimited()).toBe(true);
        });
    });

    describe('Limit Configuration', () => {
        it('should set and get token limits', () => {
            requestLimitManager.setMaxTokens(2000);
            expect(requestLimitManager.getMaxTokens()).toBe(2000);
        });

        it('should set and get request limits', () => {
            requestLimitManager.setMaxRequests(50);
            expect(requestLimitManager.getMaxRequests()).toBe(50);
        });

        it('should throw error for negative token limits', () => {
            expect(() => requestLimitManager.setMaxTokens(-100)).toThrow('Max token limit cannot be negative');
        });

        it('should throw error for negative request limits', () => {
            expect(() => requestLimitManager.setMaxRequests(-10)).toThrow('Max request limit cannot be negative');
        });

        it('should allow setting zero (unlimited)', () => {
            expect(() => requestLimitManager.setMaxTokens(0)).not.toThrow();
            expect(() => requestLimitManager.setMaxRequests(0)).not.toThrow();
        });
    });

    describe('Token Limit Checking', () => {
        it('should check estimated token limit and throw error when exceeded', () => {
            requestLimitManager.setMaxTokens(100);
            requestLimitManager.recordRequest(50);

            expect(() => requestLimitManager.checkEstimatedTokenLimit(60)).toThrow(
                'Estimated token limit would be exceeded. Current usage: 50, estimated additional tokens: 60, limit: 100. Request aborted to prevent unnecessary costs.'
            );
        });

        it('should allow estimated token usage within limit', () => {
            requestLimitManager.setMaxTokens(100);
            requestLimitManager.recordRequest(50);

            expect(() => requestLimitManager.checkEstimatedTokenLimit(30)).not.toThrow();
        });

        it('should not check estimated tokens if unlimited (0)', () => {
            requestLimitManager.setMaxTokens(0);
            expect(() => requestLimitManager.checkEstimatedTokenLimit(1000000)).not.toThrow();
        });

        it('should check actual token limit and throw error when exceeded', () => {
            requestLimitManager.setMaxTokens(100);
            requestLimitManager.recordRequest(50);

            expect(() => requestLimitManager.checkTokenLimit(60)).toThrow(
                'Token limit exceeded. Current usage: 50, attempting to add: 60, limit: 100'
            );
        });

        it('should allow token usage within limit', () => {
            requestLimitManager.setMaxTokens(100);
            requestLimitManager.recordRequest(50);

            expect(() => requestLimitManager.checkTokenLimit(30)).not.toThrow();
        });

        it('should not check tokens if unlimited (0)', () => {
            requestLimitManager.setMaxTokens(0);
            expect(() => requestLimitManager.checkTokenLimit(1000000)).not.toThrow();
        });
    });

    describe('Request Limit Checking', () => {
        it('should check request limit and throw error when exceeded', () => {
            requestLimitManager.setMaxRequests(2);
            requestLimitManager.recordRequest(10);
            requestLimitManager.recordRequest(10);

            expect(() => requestLimitManager.checkRequestLimit()).toThrow(
                'Request limit exceeded. Current requests: 2, limit: 2'
            );
        });

        it('should allow requests within limit', () => {
            requestLimitManager.setMaxRequests(5);
            requestLimitManager.recordRequest(10);

            expect(() => requestLimitManager.checkRequestLimit()).not.toThrow();
        });

        it('should not check requests if unlimited (0)', () => {
            requestLimitManager.setMaxRequests(0);
            // Record many requests
            for (let i = 0; i < 1000; i++) {
                requestLimitManager.recordRequest(1);
            }
            expect(() => requestLimitManager.checkRequestLimit()).not.toThrow();
        });
    });

    describe('Request Recording', () => {
        it('should record request and token usage', () => {
            requestLimitManager.recordRequest(50);

            expect(requestLimitManager.getCurrentRequestCount()).toBe(1);
            expect(requestLimitManager.getCurrentTokensUsed()).toBe(50);
        });

        it('should accumulate multiple requests', () => {
            requestLimitManager.recordRequest(30);
            requestLimitManager.recordRequest(20);

            expect(requestLimitManager.getCurrentRequestCount()).toBe(2);
            expect(requestLimitManager.getCurrentTokensUsed()).toBe(50);
        });

        it('should check limits before recording', () => {
            requestLimitManager.setMaxTokens(100);
            requestLimitManager.setMaxRequests(2);

            requestLimitManager.recordRequest(50);
            requestLimitManager.recordRequest(30);

            // This should fail due to request limit
            expect(() => requestLimitManager.recordRequest(10)).toThrow('Request limit exceeded');

            // Should not have recorded the failed request
            expect(requestLimitManager.getCurrentRequestCount()).toBe(2);
            expect(requestLimitManager.getCurrentTokensUsed()).toBe(80);
        });

        it('should check token limit before recording', () => {
            requestLimitManager.setMaxTokens(100);
            requestLimitManager.recordRequest(60);

            expect(() => requestLimitManager.recordRequest(50)).toThrow('Token limit exceeded');

            // Should not have recorded the failed request
            expect(requestLimitManager.getCurrentRequestCount()).toBe(1);
            expect(requestLimitManager.getCurrentTokensUsed()).toBe(60);
        });
    });

    describe('Remaining Calculations', () => {
        it('should calculate remaining tokens correctly', () => {
            requestLimitManager.setMaxTokens(100);
            requestLimitManager.recordRequest(30);

            expect(requestLimitManager.getRemainingTokens()).toBe(70);
        });

        it('should calculate remaining requests correctly', () => {
            requestLimitManager.setMaxRequests(10);
            requestLimitManager.recordRequest(25);
            requestLimitManager.recordRequest(25);

            expect(requestLimitManager.getRemainingRequests()).toBe(8);
        });

        it('should return undefined for unlimited tokens', () => {
            requestLimitManager.setMaxTokens(0);
            expect(requestLimitManager.getRemainingTokens()).toBeUndefined();
        });

        it('should return undefined for unlimited requests', () => {
            requestLimitManager.setMaxRequests(0);
            expect(requestLimitManager.getRemainingRequests()).toBeUndefined();
        });

        it('should not return negative remaining values', () => {
            requestLimitManager.setMaxTokens(100);

            // This should throw, so we need to catch it or test differently
            try {
                requestLimitManager.recordRequest(120); // This will throw
            } catch (error) {
                // Expected to throw, that's fine
            }

            // The remaining should still be based on the limit and current usage (0)
            const info = requestLimitManager.getLimitInfo();
            expect(info.remainingTokens).toBe(100); // Should be max(0, 100 - 0)
        });
    });

    describe('Reset Functionality', () => {
        it('should reset usage counters but keep limits', () => {
            requestLimitManager.setMaxTokens(200);
            requestLimitManager.setMaxRequests(10);
            requestLimitManager.recordRequest(50);
            requestLimitManager.recordRequest(30);

            requestLimitManager.reset();

            expect(requestLimitManager.getCurrentRequestCount()).toBe(0);
            expect(requestLimitManager.getCurrentTokensUsed()).toBe(0);
            expect(requestLimitManager.getMaxTokens()).toBe(200);
            expect(requestLimitManager.getMaxRequests()).toBe(10);
        });
    });

    describe('Comprehensive Limit Information', () => {
        it('should provide comprehensive limit information', () => {
            requestLimitManager.setMaxTokens(1000);
            requestLimitManager.setMaxRequests(20);
            requestLimitManager.recordRequest(100);
            requestLimitManager.recordRequest(50);

            const info = requestLimitManager.getLimitInfo();

            expect(info).toEqual({
                maxTokens: 1000,
                maxRequests: 20,
                currentTokensUsed: 150,
                currentRequestCount: 2,
                remainingTokens: 850,
                remainingRequests: 18,
                isTokensUnlimited: false,
                isRequestsUnlimited: false
            });
        });

        it('should show unlimited status correctly', () => {
            const unlimitedManager = new RequestLimitManager(0, 0);
            unlimitedManager.recordRequest(100);

            const info = unlimitedManager.getLimitInfo();

            expect(info.isTokensUnlimited).toBe(true);
            expect(info.isRequestsUnlimited).toBe(true);
            expect(info.remainingTokens).toBeUndefined();
            expect(info.remainingRequests).toBeUndefined();
        });
    });
}); 
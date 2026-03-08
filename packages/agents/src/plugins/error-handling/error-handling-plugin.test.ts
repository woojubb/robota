import { describe, it, expect, vi } from 'vitest';
import { ErrorHandlingPlugin } from './error-handling-plugin';
import { ConfigurationError } from '../../utils/errors';

describe('ErrorHandlingPlugin', () => {
    describe('constructor', () => {
        it('initializes with simple strategy', () => {
            const plugin = new ErrorHandlingPlugin({ strategy: 'simple' });
            expect(plugin.name).toBe('ErrorHandlingPlugin');
            expect(plugin.version).toBe('1.0.0');
        });

        it('throws on missing strategy', () => {
            expect(() => new ErrorHandlingPlugin({ strategy: '' as any }))
                .toThrow(ConfigurationError);
        });

        it('throws on invalid strategy', () => {
            expect(() => new ErrorHandlingPlugin({ strategy: 'invalid' as any }))
                .toThrow(ConfigurationError);
        });

        it('throws on negative maxRetries', () => {
            expect(() => new ErrorHandlingPlugin({ strategy: 'simple', maxRetries: -1 }))
                .toThrow(ConfigurationError);
        });

        it('throws on non-positive retryDelay', () => {
            expect(() => new ErrorHandlingPlugin({ strategy: 'simple', retryDelay: 0 }))
                .toThrow(ConfigurationError);
        });
    });

    describe('handleError', () => {
        it('handles error with simple strategy', async () => {
            const plugin = new ErrorHandlingPlugin({ strategy: 'simple' });
            await expect(plugin.handleError(new Error('test'))).resolves.not.toThrow();
        });

        it('handles error with silent strategy', async () => {
            const plugin = new ErrorHandlingPlugin({ strategy: 'silent' });
            await expect(plugin.handleError(new Error('test'))).resolves.not.toThrow();
        });

        it('invokes custom error handler when provided', async () => {
            const customHandler = vi.fn().mockResolvedValue(undefined);
            const plugin = new ErrorHandlingPlugin({
                strategy: 'simple',
                customErrorHandler: customHandler
            });

            const error = new Error('custom test');
            await plugin.handleError(error, { executionId: 'e1' });

            expect(customHandler).toHaveBeenCalledWith(error, { executionId: 'e1' });
        });

        it('falls back to strategy when custom handler throws', async () => {
            const customHandler = vi.fn().mockRejectedValue(new Error('handler fail'));
            const plugin = new ErrorHandlingPlugin({
                strategy: 'simple',
                customErrorHandler: customHandler
            });

            await expect(plugin.handleError(new Error('test'))).resolves.not.toThrow();
        });
    });

    describe('circuit breaker', () => {
        it('opens circuit after reaching failure threshold', async () => {
            const plugin = new ErrorHandlingPlugin({
                strategy: 'circuit-breaker',
                failureThreshold: 3
            });

            for (let i = 0; i < 3; i++) {
                await plugin.handleError(new Error(`error ${i}`));
            }

            const stats = plugin.getStats();
            expect(stats.circuitBreakerOpen).toBe(true);
            expect(stats.failureCount).toBe(3);
        });

        it('does not open circuit below threshold', async () => {
            const plugin = new ErrorHandlingPlugin({
                strategy: 'circuit-breaker',
                failureThreshold: 5
            });

            await plugin.handleError(new Error('error'));
            await plugin.handleError(new Error('error'));

            const stats = plugin.getStats();
            expect(stats.circuitBreakerOpen).toBe(false);
            expect(stats.failureCount).toBe(2);
        });

        it('resets circuit breaker manually', async () => {
            const plugin = new ErrorHandlingPlugin({
                strategy: 'circuit-breaker',
                failureThreshold: 2
            });

            await plugin.handleError(new Error('e1'));
            await plugin.handleError(new Error('e2'));
            expect(plugin.getStats().circuitBreakerOpen).toBe(true);

            plugin.resetCircuitBreaker();
            const stats = plugin.getStats();
            expect(stats.circuitBreakerOpen).toBe(false);
            expect(stats.failureCount).toBe(0);
            expect(stats.lastFailureTime).toBe(0);
        });
    });

    describe('executeWithRetry', () => {
        it('succeeds on first attempt', async () => {
            const plugin = new ErrorHandlingPlugin({
                strategy: 'simple',
                maxRetries: 2,
                retryDelay: 1
            });

            const fn = vi.fn().mockResolvedValue('success');
            const result = await plugin.executeWithRetry(fn);

            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('retries and succeeds on later attempt', async () => {
            const plugin = new ErrorHandlingPlugin({
                strategy: 'simple',
                maxRetries: 3,
                retryDelay: 1
            });

            const fn = vi.fn()
                .mockRejectedValueOnce(new Error('fail 1'))
                .mockRejectedValueOnce(new Error('fail 2'))
                .mockResolvedValue('success');

            const result = await plugin.executeWithRetry(fn);
            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(3);
        });

        it('throws after exhausting retries', async () => {
            const plugin = new ErrorHandlingPlugin({
                strategy: 'simple',
                maxRetries: 1,
                retryDelay: 1
            });

            const fn = vi.fn().mockRejectedValue(new Error('always fail'));

            await expect(plugin.executeWithRetry(fn)).rejects.toThrow(
                'Operation failed after 1 retries'
            );
            expect(fn).toHaveBeenCalledTimes(2); // initial + 1 retry
        });

        it('blocks when circuit breaker is open', async () => {
            const plugin = new ErrorHandlingPlugin({
                strategy: 'circuit-breaker',
                failureThreshold: 1,
                maxRetries: 0,
                retryDelay: 1,
                circuitBreakerTimeout: 60000
            });

            // Open the circuit breaker
            await plugin.handleError(new Error('trip'));
            expect(plugin.getStats().circuitBreakerOpen).toBe(true);

            const fn = vi.fn().mockResolvedValue('ok');
            await expect(plugin.executeWithRetry(fn)).rejects.toThrow('Operation failed after 0 retries');
            expect(fn).not.toHaveBeenCalled();
        });
    });

    describe('getStats', () => {
        it('returns initial stats', () => {
            const plugin = new ErrorHandlingPlugin({ strategy: 'simple' });
            const stats = plugin.getStats();

            expect(stats.failureCount).toBe(0);
            expect(stats.circuitBreakerOpen).toBe(false);
            expect(stats.lastFailureTime).toBe(0);
        });
    });

    describe('destroy', () => {
        it('completes without error', async () => {
            const plugin = new ErrorHandlingPlugin({ strategy: 'simple' });
            await expect(plugin.destroy()).resolves.not.toThrow();
        });
    });
});

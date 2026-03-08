import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startPeriodicTask, stopPeriodicTask } from './periodic-task';
import type { ILogger } from './logger';

function createMockLogger(): ILogger {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        log: vi.fn(),
    };
}

// Helper to flush microtasks created by the void async IIFE inside setInterval
function flushMicrotasks(): Promise<void> {
    return new Promise(resolve => {
        queueMicrotask(resolve);
    });
}

describe('startPeriodicTask', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('should call the task at the specified interval', async () => {
        const logger = createMockLogger();
        const task = vi.fn().mockResolvedValue(undefined);

        const timer = startPeriodicTask(logger, { name: 'test-task', intervalMs: 1000 }, task);

        expect(task).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1000);
        expect(task).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1000);
        expect(task).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(1000);
        expect(task).toHaveBeenCalledTimes(3);

        stopPeriodicTask(timer);
    });

    it('should log errors when the task throws', async () => {
        const logger = createMockLogger();
        const task = vi.fn().mockRejectedValue(new Error('task failed'));

        const timer = startPeriodicTask(logger, { name: 'failing-task', intervalMs: 500 }, task);

        await vi.advanceTimersByTimeAsync(500);

        expect(logger.error).toHaveBeenCalledWith(
            'Periodic task failed',
            expect.objectContaining({
                task: 'failing-task',
                error: 'task failed',
            })
        );

        stopPeriodicTask(timer);
    });

    it('should log stringified error when task throws a non-Error value', async () => {
        const logger = createMockLogger();
        const task = vi.fn().mockRejectedValue('string error');

        const timer = startPeriodicTask(logger, { name: 'string-error-task', intervalMs: 500 }, task);

        await vi.advanceTimersByTimeAsync(500);

        expect(logger.error).toHaveBeenCalledWith(
            'Periodic task failed',
            expect.objectContaining({
                task: 'string-error-task',
                error: 'string error',
            })
        );

        stopPeriodicTask(timer);
    });
});

describe('stopPeriodicTask', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('should stop the periodic task from firing', async () => {
        const logger = createMockLogger();
        const task = vi.fn().mockResolvedValue(undefined);

        const timer = startPeriodicTask(logger, { name: 'stop-test', intervalMs: 1000 }, task);

        await vi.advanceTimersByTimeAsync(1000);
        expect(task).toHaveBeenCalledTimes(1);

        stopPeriodicTask(timer);

        await vi.advanceTimersByTimeAsync(3000);
        expect(task).toHaveBeenCalledTimes(1);
    });

    it('should handle undefined gracefully', () => {
        expect(() => stopPeriodicTask(undefined)).not.toThrow();
    });

    it('should handle null gracefully', () => {
        expect(() => stopPeriodicTask(null)).not.toThrow();
    });
});

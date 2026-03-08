import type { ILogger } from './logger';
import type { TTimerId } from './index';

interface IPeriodicTaskOptions {
    name: string;
    intervalMs: number;
}

/**
 * Start a periodic async task with consistent error logging.
 * SSOT helper to avoid duplicating setInterval(async () => ...) patterns.
 */
export function startPeriodicTask(
    logger: ILogger,
    options: IPeriodicTaskOptions,
    task: () => Promise<void>
): TTimerId {
    const timer: TTimerId = setInterval(() => {
        void (async () => {
            try {
                await task();
            } catch (error) {
                logger.error('Periodic task failed', {
                    task: options.name,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        })();
    }, options.intervalMs);

    return timer;
}

export function stopPeriodicTask(timer: TTimerId | undefined | null): void {
    if (!timer) return;
    clearInterval(timer);
}



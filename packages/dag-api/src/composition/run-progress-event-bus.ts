import type { TRunProgressEvent } from '@robota-sdk/dag-core';

/** Callback type for receiving run progress events. */
export type TRunProgressEventListener = (event: TRunProgressEvent) => void;

/** Logger port for reporting event bus errors. */
export interface IRunProgressLogger {
    error(message: string, context?: Record<string, unknown>): void;
}

/** Contract for publishing and subscribing to run progress events. */
export interface IRunProgressEventBus {
    publish: (event: TRunProgressEvent) => void;
    subscribe: (listener: TRunProgressEventListener) => () => void;
}

/**
 * In-memory event bus for broadcasting run progress events to subscribers.
 * When a logger is provided, listener errors are logged and swallowed; otherwise the first error is rethrown.
 * @see IRunProgressEventBus
 */
export class RunProgressEventBus implements IRunProgressEventBus {
    private readonly listeners = new Set<TRunProgressEventListener>();
    private readonly logger?: IRunProgressLogger;

    public constructor(logger?: IRunProgressLogger) {
        this.logger = logger;
    }

    /**
     * Publishes an event to all registered listeners.
     * @param event - The run progress event to broadcast.
     */
    public publish(event: TRunProgressEvent): void {
        const errors: unknown[] = [];
        for (const listener of [...this.listeners]) {
            try {
                listener(event);
            } catch (error: unknown) {
                errors.push(error);
                if (this.logger) {
                    this.logger.error('RunProgressEventBus listener threw an error', {
                        eventType: event.eventType,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }
        }
        if (errors.length > 0 && !this.logger) {
            throw errors[0] instanceof Error
                ? errors[0]
                : new Error(String(errors[0]));
        }
    }

    /**
     * Registers a listener for run progress events.
     * @param listener - The callback to invoke on each event.
     * @returns Unsubscribe function that removes the listener.
     */
    public subscribe(listener: TRunProgressEventListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
}

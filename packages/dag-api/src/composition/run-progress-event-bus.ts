import type { TRunProgressEvent } from '@robota-sdk/dag-core';

export type TRunProgressEventListener = (event: TRunProgressEvent) => void;

export interface IRunProgressLogger {
    error(message: string, context?: Record<string, unknown>): void;
}

export interface IRunProgressEventBus {
    publish: (event: TRunProgressEvent) => void;
    subscribe: (listener: TRunProgressEventListener) => () => void;
}

export class RunProgressEventBus implements IRunProgressEventBus {
    private readonly listeners = new Set<TRunProgressEventListener>();
    private readonly logger?: IRunProgressLogger;

    public constructor(logger?: IRunProgressLogger) {
        this.logger = logger;
    }

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

    public subscribe(listener: TRunProgressEventListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
}

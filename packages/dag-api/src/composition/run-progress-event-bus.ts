import type { TRunProgressEvent } from '@robota-sdk/dag-core';

export type TRunProgressEventListener = (event: TRunProgressEvent) => void;

export interface IRunProgressEventBus {
    publish: (event: TRunProgressEvent) => void;
    subscribe: (listener: TRunProgressEventListener) => () => void;
}

export class RunProgressEventBus implements IRunProgressEventBus {
    private readonly listeners = new Set<TRunProgressEventListener>();

    public publish(event: TRunProgressEvent): void {
        for (const listener of [...this.listeners]) {
            try {
                listener(event);
            } catch {
                this.listeners.delete(listener);
            }
        }
    }

    public subscribe(listener: TRunProgressEventListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
}

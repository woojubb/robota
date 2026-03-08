export interface IEventEmitterMetricsSnapshot {
    totalEmitted: number;
    totalErrors: number;
}

export interface IEventEmitterMetrics {
    incrementEmitted(): void;
    incrementErrors(): void;
    getSnapshot(): IEventEmitterMetricsSnapshot;
}

export class InMemoryEventEmitterMetrics implements IEventEmitterMetrics {
    private totalEmitted = 0;
    private totalErrors = 0;

    incrementEmitted(): void {
        this.totalEmitted += 1;
    }

    incrementErrors(): void {
        this.totalErrors += 1;
    }

    getSnapshot(): IEventEmitterMetricsSnapshot {
        return {
            totalEmitted: this.totalEmitted,
            totalErrors: this.totalErrors
        };
    }
}

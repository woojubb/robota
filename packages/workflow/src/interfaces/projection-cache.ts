export type TProjectionCacheNamespace = 'workflowProjection' | 'historyProjection';

export interface IProjectionCachePolicy {
    workflowProjectionTtlMs: number;
    historyProjectionTtlMs: number;
    workflowInvalidationPrefixes: readonly string[];
    historyInvalidationPrefixes: readonly string[];
}

export interface IProjectionCacheNamespaceStats {
    hits: number;
    misses: number;
    writes: number;
    invalidations: number;
}

export interface IProjectionCacheStats {
    workflowProjection: IProjectionCacheNamespaceStats;
    historyProjection: IProjectionCacheNamespaceStats;
}

export interface IProjectionCacheService<TWorkflowValue, THistoryValue> {
    readWorkflow(key: string): TWorkflowValue | undefined;
    readHistory(key: string): THistoryValue | undefined;
    writeWorkflow(key: string, value: TWorkflowValue): void;
    writeHistory(key: string, value: THistoryValue): void;
    updateWorkflowAtomic(
        key: string,
        updater: (previous: TWorkflowValue | undefined) => TWorkflowValue
    ): TWorkflowValue;
    updateHistoryAtomic(
        key: string,
        updater: (previous: THistoryValue | undefined) => THistoryValue
    ): THistoryValue;
    invalidateWorkflow(key: string): void;
    invalidateHistory(key: string): void;
    invalidateByEventName(eventName: string): { workflowInvalidated: boolean; historyInvalidated: boolean };
    clearAll(): void;
    getStats(): IProjectionCacheStats;
}

import type {
    IProjectionCachePolicy,
    IProjectionCacheService,
    IProjectionCacheStats
} from '../interfaces/projection-cache.js';
import {
    AGENT_EVENT_PREFIX,
    EXECUTION_EVENT_PREFIX,
    TASK_EVENT_PREFIX,
    TOOL_EVENT_PREFIX,
    USER_EVENT_PREFIX
} from '@robota-sdk/agents';

interface IProjectionCacheEntry<TValue> {
    value: TValue;
    expiresAt: number;
}

const DEFAULT_POLICY: IProjectionCachePolicy = {
    workflowProjectionTtlMs: 30_000,
    historyProjectionTtlMs: 30_000,
    workflowInvalidationPrefixes: [
        `${EXECUTION_EVENT_PREFIX}.`,
        `${TOOL_EVENT_PREFIX}.`,
        `${AGENT_EVENT_PREFIX}.`,
        `${USER_EVENT_PREFIX}.`,
        `${TASK_EVENT_PREFIX}.`
    ],
    historyInvalidationPrefixes: [
        `${EXECUTION_EVENT_PREFIX}.`,
        `${TOOL_EVENT_PREFIX}.`,
        `${AGENT_EVENT_PREFIX}.`,
        `${USER_EVENT_PREFIX}.`,
        `${TASK_EVENT_PREFIX}.`
    ]
};

const DEFAULT_STATS = (): IProjectionCacheStats => ({
    workflowProjection: { hits: 0, misses: 0, writes: 0, invalidations: 0 },
    historyProjection: { hits: 0, misses: 0, writes: 0, invalidations: 0 }
});

export class InMemoryProjectionCache<TWorkflowValue, THistoryValue>
    implements IProjectionCacheService<TWorkflowValue, THistoryValue> {
    private readonly workflowCache = new Map<string, IProjectionCacheEntry<TWorkflowValue>>();
    private readonly historyCache = new Map<string, IProjectionCacheEntry<THistoryValue>>();
    private readonly policy: IProjectionCachePolicy;
    private readonly stats: IProjectionCacheStats = DEFAULT_STATS();
    private readonly now: () => number;

    constructor(policy?: Partial<IProjectionCachePolicy>, nowProvider: () => number = () => Date.now()) {
        this.policy = {
            ...DEFAULT_POLICY,
            ...policy,
            workflowInvalidationPrefixes: policy?.workflowInvalidationPrefixes ?? DEFAULT_POLICY.workflowInvalidationPrefixes,
            historyInvalidationPrefixes: policy?.historyInvalidationPrefixes ?? DEFAULT_POLICY.historyInvalidationPrefixes
        };
        this.now = nowProvider;
    }

    readWorkflow(key: string): TWorkflowValue | undefined {
        return this.readFromNamespace('workflowProjection', this.workflowCache, key);
    }

    readHistory(key: string): THistoryValue | undefined {
        return this.readFromNamespace('historyProjection', this.historyCache, key);
    }

    writeWorkflow(key: string, value: TWorkflowValue): void {
        this.writeToNamespace('workflowProjection', this.workflowCache, key, value, this.policy.workflowProjectionTtlMs);
    }

    writeHistory(key: string, value: THistoryValue): void {
        this.writeToNamespace('historyProjection', this.historyCache, key, value, this.policy.historyProjectionTtlMs);
    }

    updateWorkflowAtomic(
        key: string,
        updater: (previous: TWorkflowValue | undefined) => TWorkflowValue
    ): TWorkflowValue {
        return this.updateNamespaceAtomic(
            'workflowProjection',
            this.workflowCache,
            key,
            updater,
            this.policy.workflowProjectionTtlMs
        );
    }

    updateHistoryAtomic(
        key: string,
        updater: (previous: THistoryValue | undefined) => THistoryValue
    ): THistoryValue {
        return this.updateNamespaceAtomic(
            'historyProjection',
            this.historyCache,
            key,
            updater,
            this.policy.historyProjectionTtlMs
        );
    }

    invalidateWorkflow(key: string): void {
        this.invalidateKey('workflowProjection', this.workflowCache, key);
    }

    invalidateHistory(key: string): void {
        this.invalidateKey('historyProjection', this.historyCache, key);
    }

    invalidateByEventName(eventName: string): { workflowInvalidated: boolean; historyInvalidated: boolean } {
        const workflowInvalidated = this.matchesPrefix(eventName, this.policy.workflowInvalidationPrefixes);
        const historyInvalidated = this.matchesPrefix(eventName, this.policy.historyInvalidationPrefixes);

        if (workflowInvalidated) {
            this.stats.workflowProjection.invalidations += this.workflowCache.size;
            this.workflowCache.clear();
        }
        if (historyInvalidated) {
            this.stats.historyProjection.invalidations += this.historyCache.size;
            this.historyCache.clear();
        }

        return { workflowInvalidated, historyInvalidated };
    }

    clearAll(): void {
        this.workflowCache.clear();
        this.historyCache.clear();
    }

    getStats(): IProjectionCacheStats {
        return {
            workflowProjection: { ...this.stats.workflowProjection },
            historyProjection: { ...this.stats.historyProjection }
        };
    }

    private readFromNamespace<TValue>(
        namespace: 'workflowProjection' | 'historyProjection',
        cache: Map<string, IProjectionCacheEntry<TValue>>,
        key: string
    ): TValue | undefined {
        const entry = cache.get(key);
        if (!entry) {
            this.stats[namespace].misses += 1;
            return undefined;
        }
        if (this.isExpired(entry.expiresAt)) {
            cache.delete(key);
            this.stats[namespace].misses += 1;
            this.stats[namespace].invalidations += 1;
            return undefined;
        }
        this.stats[namespace].hits += 1;
        return entry.value;
    }

    private writeToNamespace<TValue>(
        namespace: 'workflowProjection' | 'historyProjection',
        cache: Map<string, IProjectionCacheEntry<TValue>>,
        key: string,
        value: TValue,
        ttlMs: number
    ): void {
        cache.set(key, {
            value,
            expiresAt: this.now() + ttlMs
        });
        this.stats[namespace].writes += 1;
    }

    private updateNamespaceAtomic<TValue>(
        namespace: 'workflowProjection' | 'historyProjection',
        cache: Map<string, IProjectionCacheEntry<TValue>>,
        key: string,
        updater: (previous: TValue | undefined) => TValue,
        ttlMs: number
    ): TValue {
        const previous = this.readFromNamespace(namespace, cache, key);
        const next = updater(previous);
        this.writeToNamespace(namespace, cache, key, next, ttlMs);
        return next;
    }

    private invalidateKey<TValue>(
        namespace: 'workflowProjection' | 'historyProjection',
        cache: Map<string, IProjectionCacheEntry<TValue>>,
        key: string
    ): void {
        const existed = cache.delete(key);
        if (existed) {
            this.stats[namespace].invalidations += 1;
        }
    }

    private isExpired(expiresAt: number): boolean {
        return this.now() >= expiresAt;
    }

    private matchesPrefix(eventName: string, prefixes: readonly string[]): boolean {
        for (const prefix of prefixes) {
            if (eventName.startsWith(prefix)) {
                return true;
            }
        }
        return false;
    }
}

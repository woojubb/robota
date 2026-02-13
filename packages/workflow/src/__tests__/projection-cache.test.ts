import { describe, expect, it } from 'vitest';
import { InMemoryProjectionCache } from '../services/projection-cache.js';

describe('InMemoryProjectionCache', () => {
    it('should read written workflow/history cache entries', () => {
        const cache = new InMemoryProjectionCache<{ version: number }, { count: number }>();
        cache.writeWorkflow('workflow:key', { version: 1 });
        cache.writeHistory('history:key', { count: 10 });

        expect(cache.readWorkflow('workflow:key')).toEqual({ version: 1 });
        expect(cache.readHistory('history:key')).toEqual({ count: 10 });
    });

    it('should expire entries by ttl', () => {
        let now = 0;
        const cache = new InMemoryProjectionCache<{ value: string }, { value: string }>(
            { workflowProjectionTtlMs: 10, historyProjectionTtlMs: 10 },
            () => now
        );
        cache.writeWorkflow('w', { value: 'workflow' });
        cache.writeHistory('h', { value: 'history' });

        now = 5;
        expect(cache.readWorkflow('w')).toEqual({ value: 'workflow' });
        expect(cache.readHistory('h')).toEqual({ value: 'history' });

        now = 10;
        expect(cache.readWorkflow('w')).toBeUndefined();
        expect(cache.readHistory('h')).toBeUndefined();
    });

    it('should invalidate by configured event prefixes', () => {
        const cache = new InMemoryProjectionCache<{ v: number }, { v: number }>({
            workflowInvalidationPrefixes: ['execution.'],
            historyInvalidationPrefixes: ['user.']
        });
        cache.writeWorkflow('w', { v: 1 });
        cache.writeHistory('h', { v: 2 });

        const executionInvalidate = cache.invalidateByEventName('execution.start');
        expect(executionInvalidate).toEqual({ workflowInvalidated: true, historyInvalidated: false });
        expect(cache.readWorkflow('w')).toBeUndefined();
        expect(cache.readHistory('h')).toEqual({ v: 2 });

        const userInvalidate = cache.invalidateByEventName('user.message');
        expect(userInvalidate).toEqual({ workflowInvalidated: false, historyInvalidated: true });
        expect(cache.readHistory('h')).toBeUndefined();
    });

    it('should update atomically using previous value', () => {
        const cache = new InMemoryProjectionCache<{ version: number }, { items: number }>();
        const first = cache.updateWorkflowAtomic('w', previous => ({
            version: (previous?.version ?? 0) + 1
        }));
        const second = cache.updateWorkflowAtomic('w', previous => ({
            version: (previous?.version ?? 0) + 1
        }));
        const history = cache.updateHistoryAtomic('h', previous => ({
            items: (previous?.items ?? 0) + 2
        }));

        expect(first).toEqual({ version: 1 });
        expect(second).toEqual({ version: 2 });
        expect(history).toEqual({ items: 2 });
        expect(cache.readWorkflow('w')).toEqual({ version: 2 });
        expect(cache.readHistory('h')).toEqual({ items: 2 });
    });
});

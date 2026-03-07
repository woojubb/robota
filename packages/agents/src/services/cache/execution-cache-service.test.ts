import { describe, it, expect, beforeEach } from 'vitest';
import { ExecutionCacheService } from './execution-cache-service';
import { MemoryCacheStorage } from './memory-cache-storage';
import { CacheKeyBuilder } from './cache-key-builder';
import { CacheIntegrityError } from '../../utils/errors';
import type { TUniversalMessage } from '../../interfaces/messages';

describe('ExecutionCacheService', () => {
    let service: ExecutionCacheService;
    let storage: MemoryCacheStorage;

    const messages: TUniversalMessage[] = [
        { role: 'user', content: 'Hello', timestamp: new Date() }
    ];

    beforeEach(() => {
        storage = new MemoryCacheStorage({ maxEntries: 100, ttlMs: 60000 });
        service = new ExecutionCacheService(storage, new CacheKeyBuilder());
    });

    describe('lookup', () => {
        it('should return null on cache miss', () => {
            const result = service.lookup(messages, 'gpt-4', 'openai');
            expect(result).toBeNull();
        });

        it('should return cached response on cache hit', () => {
            service.store(messages, 'gpt-4', 'openai', 'Cached response');

            const result = service.lookup(messages, 'gpt-4', 'openai');
            expect(result).toBe('Cached response');
        });
    });

    describe('store', () => {
        it('should store successful response', () => {
            service.store(messages, 'gpt-4', 'openai', 'Hello world');

            const result = service.lookup(messages, 'gpt-4', 'openai');
            expect(result).toBe('Hello world');
        });
    });

    describe('integrity error propagation', () => {
        it('should propagate CacheIntegrityError without fallback', () => {
            service.store(messages, 'gpt-4', 'openai', 'Hello world');

            // Corrupt the storage entry directly
            const keyBuilder = new CacheKeyBuilder();
            const key = keyBuilder.build(messages, 'gpt-4', 'openai');
            const entry = storage.get(key.hash);
            if (entry) {
                // Re-insert with tampered integrity hash
                storage.delete(key.hash);
                storage.set({ ...entry, integrityHash: 'tampered' });
            }

            expect(() => service.lookup(messages, 'gpt-4', 'openai')).toThrow(CacheIntegrityError);
        });
    });

    describe('getStats', () => {
        it('should return storage stats', () => {
            service.store(messages, 'gpt-4', 'openai', 'Hello');
            service.lookup(messages, 'gpt-4', 'openai'); // hit
            service.lookup([{ role: 'user', content: 'X', timestamp: new Date() }], 'gpt-4', 'openai'); // miss

            const stats = service.getStats();
            expect(stats.hits).toBe(1);
            expect(stats.misses).toBe(1);
            expect(stats.entries).toBe(1);
        });
    });
});

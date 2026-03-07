import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryCacheStorage } from './memory-cache-storage';
import type { ICacheEntry } from '../../interfaces/cache';
import { CacheIntegrityError } from '../../utils/errors';
import { CacheKeyBuilder } from './cache-key-builder';

describe('MemoryCacheStorage', () => {
    let storage: MemoryCacheStorage;
    const keyBuilder = new CacheKeyBuilder();

    const createEntry = (hash: string, response: string): ICacheEntry => ({
        key: { hash, model: 'gpt-4', provider: 'openai' },
        response,
        timestamp: Date.now(),
        integrityHash: keyBuilder.computeIntegrityHash(response)
    });

    beforeEach(() => {
        storage = new MemoryCacheStorage({ maxEntries: 3, ttlMs: 60000 });
    });

    describe('get/set', () => {
        it('should store and retrieve an entry', () => {
            const entry = createEntry('abc', 'Hello');
            storage.set(entry);

            const result = storage.get('abc');
            expect(result).toEqual(entry);
        });

        it('should return undefined for missing key', () => {
            expect(storage.get('nonexistent')).toBeUndefined();
        });
    });

    describe('delete', () => {
        it('should delete an existing entry', () => {
            storage.set(createEntry('abc', 'Hello'));
            expect(storage.delete('abc')).toBe(true);
            expect(storage.get('abc')).toBeUndefined();
        });

        it('should return false for non-existing entry', () => {
            expect(storage.delete('nonexistent')).toBe(false);
        });
    });

    describe('clear', () => {
        it('should remove all entries', () => {
            storage.set(createEntry('a', 'A'));
            storage.set(createEntry('b', 'B'));
            storage.clear();
            expect(storage.getStats().entries).toBe(0);
        });
    });

    describe('TTL expiry', () => {
        it('should return undefined for expired entries', () => {
            storage = new MemoryCacheStorage({ maxEntries: 10, ttlMs: 100 });
            const entry = createEntry('abc', 'Hello');
            entry.timestamp = Date.now() - 200;
            storage.set(entry);

            expect(storage.get('abc')).toBeUndefined();
        });
    });

    describe('LRU eviction', () => {
        it('should evict least recently used entry when maxEntries exceeded', () => {
            storage.set(createEntry('a', 'A'));
            storage.set(createEntry('b', 'B'));
            storage.set(createEntry('c', 'C'));

            // Access 'a' to make it recently used
            storage.get('a');

            // Adding 'd' should evict 'b' (least recently used)
            storage.set(createEntry('d', 'D'));

            expect(storage.get('a')).toBeDefined();
            expect(storage.get('b')).toBeUndefined();
            expect(storage.get('c')).toBeDefined();
            expect(storage.get('d')).toBeDefined();
        });
    });

    describe('integrity validation', () => {
        it('should throw CacheIntegrityError when integrity hash does not match', () => {
            const entry = createEntry('abc', 'Hello');
            entry.integrityHash = 'tampered-hash';
            storage.set(entry);

            expect(() => storage.get('abc')).toThrow(CacheIntegrityError);
        });
    });

    describe('stats', () => {
        it('should track hits and misses', () => {
            storage.set(createEntry('abc', 'Hello'));

            storage.get('abc'); // hit
            storage.get('xyz'); // miss

            const stats = storage.getStats();
            expect(stats.hits).toBe(1);
            expect(stats.misses).toBe(1);
            expect(stats.entries).toBe(1);
            expect(stats.hitRate).toBe(0.5);
        });

        it('should return 0 hitRate when no lookups', () => {
            expect(storage.getStats().hitRate).toBe(0);
        });
    });
});

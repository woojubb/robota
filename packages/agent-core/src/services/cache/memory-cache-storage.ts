import type { ICacheEntry, ICacheStorage, ICacheStats } from '../../interfaces/cache';
import { CacheIntegrityError } from '../../utils/errors';
import { CacheKeyBuilder } from './cache-key-builder';

interface IMemoryCacheStorageOptions {
  maxEntries: number;
  ttlMs: number;
}

export class MemoryCacheStorage implements ICacheStorage {
  private readonly cache = new Map<string, ICacheEntry>();
  private readonly accessOrder: string[] = [];
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly keyBuilder = new CacheKeyBuilder();
  private hits = 0;
  private misses = 0;

  constructor(options: IMemoryCacheStorageOptions) {
    this.maxEntries = options.maxEntries;
    this.ttlMs = options.ttlMs;
  }

  get(hash: string): ICacheEntry | undefined {
    const entry = this.cache.get(hash);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(hash);
      this.removeFromAccessOrder(hash);
      this.misses++;
      return undefined;
    }

    const expectedHash = this.keyBuilder.computeIntegrityHash(entry.response);
    if (entry.integrityHash !== expectedHash) {
      this.cache.delete(hash);
      this.removeFromAccessOrder(hash);
      throw new CacheIntegrityError(`Integrity check failed for cache entry ${hash}`, {
        hash,
        expected: expectedHash,
        actual: entry.integrityHash,
      });
    }

    this.touchAccessOrder(hash);
    this.hits++;
    return entry;
  }

  set(entry: ICacheEntry): void {
    const hash = entry.key.hash;

    if (!this.cache.has(hash) && this.cache.size >= this.maxEntries) {
      this.evictLRU();
    }

    this.cache.set(hash, entry);
    this.touchAccessOrder(hash);
  }

  delete(hash: string): boolean {
    if (this.cache.has(hash)) {
      this.cache.delete(hash);
      this.removeFromAccessOrder(hash);
      return true;
    }
    return false;
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder.length = 0;
    this.hits = 0;
    this.misses = 0;
  }

  getStats(): ICacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.cache.size,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }

  private touchAccessOrder(hash: string): void {
    this.removeFromAccessOrder(hash);
    this.accessOrder.push(hash);
  }

  private removeFromAccessOrder(hash: string): void {
    const idx = this.accessOrder.indexOf(hash);
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1);
    }
  }

  private evictLRU(): void {
    const lruHash = this.accessOrder.shift();
    if (lruHash) {
      this.cache.delete(lruHash);
    }
  }
}

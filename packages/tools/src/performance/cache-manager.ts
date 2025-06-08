/**
 * Cache Manager for Tool Performance Optimization
 * 
 * @module cache-manager
 * @description
 * Caches tool loading and function schema conversion results to optimize performance.
 */

import type { FunctionSchema } from '../types';

/**
 * Cache item interface
 */
export interface CacheItem<T> {
    /** Cached data */
    data: T;
    /** Cache creation timestamp */
    timestamp: number;
    /** Time to live (milliseconds) */
    ttl?: number;
    /** Access count */
    accessCount: number;
    /** Last accessed timestamp */
    lastAccessed: number;
}

/**
 * Cache statistics information
 */
export interface CacheStats {
    /** Total cache items count */
    totalItems: number;
    /** Cache hits count */
    hits: number;
    /** Cache misses count */
    misses: number;
    /** Hit rate (0-1) */
    hitRate: number;
    /** Expired items count */
    expired: number;
    /** Estimated memory usage */
    estimatedMemoryUsage: number;
}

/**
 * Cache manager class
 * 
 * Supports LRU (Least Recently Used) algorithm and TTL (Time To Live).
 */
export class CacheManager<T = any> {
    private cache: Map<string, CacheItem<T>> = new Map();
    private maxSize: number;
    private defaultTTL?: number;
    private hits = 0;
    private misses = 0;
    private expired = 0;

    constructor(options: {
        maxSize?: number;
        defaultTTL?: number; // in milliseconds
    } = {}) {
        this.maxSize = options.maxSize || 1000;
        this.defaultTTL = options.defaultTTL;
    }

    /**
     * Get value from cache
     */
    get(key: string): T | undefined {
        const item = this.cache.get(key);

        if (!item) {
            this.misses++;
            return undefined;
        }

        // Check TTL
        if (this.isExpired(item)) {
            this.cache.delete(key);
            this.expired++;
            this.misses++;
            return undefined;
        }

        // Update access information
        item.accessCount++;
        item.lastAccessed = Date.now();
        this.hits++;

        return item.data;
    }

    /**
     * Set value in cache
     */
    set(key: string, value: T, ttl?: number): void {
        // Check cache size limit
        if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
            this.evictLRU();
        }

        const now = Date.now();
        const item: CacheItem<T> = {
            data: value,
            timestamp: now,
            ttl: ttl || this.defaultTTL,
            accessCount: 1,
            lastAccessed: now
        };

        this.cache.set(key, item);
    }

    /**
     * Delete item from cache
     */
    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    /**
     * Check if specific key exists in cache
     */
    has(key: string): boolean {
        const item = this.cache.get(key);
        if (!item) return false;

        if (this.isExpired(item)) {
            this.cache.delete(key);
            this.expired++;
            return false;
        }

        return true;
    }

    /**
     * Clear entire cache
     */
    clear(): void {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
        this.expired = 0;
    }

    /**
     * Clean up expired items
     */
    cleanup(): number {
        let cleanedCount = 0;
        const now = Date.now();

        for (const [key, item] of this.cache.entries()) {
            if (this.isExpired(item, now)) {
                this.cache.delete(key);
                cleanedCount++;
                this.expired++;
            }
        }

        return cleanedCount;
    }

    /**
     * Get cache statistics
     */
    getStats(): CacheStats {
        const totalRequests = this.hits + this.misses;
        const hitRate = totalRequests > 0 ? this.hits / totalRequests : 0;

        // Estimate memory usage (approximate size of keys + data)
        let estimatedMemoryUsage = 0;
        for (const [key, item] of this.cache.entries()) {
            estimatedMemoryUsage += key.length * 2; // UTF-16 characters
            estimatedMemoryUsage += this.estimateObjectSize(item);
        }

        return {
            totalItems: this.cache.size,
            hits: this.hits,
            misses: this.misses,
            hitRate,
            expired: this.expired,
            estimatedMemoryUsage
        };
    }

    /**
     * Get all cache keys
     */
    keys(): string[] {
        return Array.from(this.cache.keys());
    }

    /**
     * Get all cache values
     */
    values(): T[] {
        return Array.from(this.cache.values()).map(item => item.data);
    }

    /**
     * Get cache size
     */
    size(): number {
        return this.cache.size;
    }

    /**
     * Check if item has expired
     */
    private isExpired(item: CacheItem<T>, now?: number): boolean {
        if (!item.ttl) return false;

        const currentTime = now || Date.now();
        return currentTime - item.timestamp > item.ttl;
    }

    /**
     * Evict least recently used item using LRU algorithm
     */
    private evictLRU(): void {
        let lruKey: string | undefined;
        let lruTime = Infinity;

        for (const [key, item] of this.cache.entries()) {
            if (item.lastAccessed < lruTime) {
                lruTime = item.lastAccessed;
                lruKey = key;
            }
        }

        if (lruKey) {
            this.cache.delete(lruKey);
        }
    }

    /**
     * Estimate object size (approximate)
     */
    private estimateObjectSize(obj: any): number {
        let size = 0;

        if (obj === null || obj === undefined) {
            return 8; // pointer size
        }

        switch (typeof obj) {
            case 'string':
                return obj.length * 2; // UTF-16
            case 'number':
                return 8;
            case 'boolean':
                return 4;
            case 'object':
                if (Array.isArray(obj)) {
                    return obj.reduce((acc, item) => acc + this.estimateObjectSize(item), 0);
                } else {
                    for (const key in obj) {
                        size += key.length * 2; // key size
                        size += this.estimateObjectSize(obj[key]); // value size
                    }
                    return size;
                }
            default:
                return 16; // other types
        }
    }
}

/**
 * Function schema specific cache manager
 */
export class FunctionSchemaCacheManager extends CacheManager<FunctionSchema[]> {
    constructor() {
        super({
            maxSize: 500, // smaller number as function schemas can be large
            defaultTTL: 30 * 60 * 1000 // 30 minutes
        });
    }

    /**
     * Generate cache key from tool definitions
     */
    generateKey(toolDefinitions: Record<string, any>): string {
        // Generate hash from tool definitions to use as cache key
        const keys = Object.keys(toolDefinitions).sort();
        const signature = keys.map(key => {
            const tool = toolDefinitions[key];
            return `${key}:${tool.name}:${tool.description}`;
        }).join('|');

        return this.simpleHash(signature);
    }

    /**
     * Simple hash function
     */
    private simpleHash(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // convert to 32-bit integer
        }
        return Math.abs(hash).toString(36);
    }
}

/**
 * Global cache manager instances
 */
export const globalFunctionSchemaCache = new FunctionSchemaCacheManager();
export const globalToolCache = new CacheManager<any>({
    maxSize: 1000,
    defaultTTL: 60 * 60 * 1000 // 1 hour
});

/**
 * Utility for periodically executing cache cleanup tasks
 */
export class CacheCleanupScheduler {
    private intervals: NodeJS.Timeout[] = [];

    /**
     * Start periodic cache cleanup
     */
    start(cacheManagers: CacheManager[], intervalMs: number = 5 * 60 * 1000): void {
        for (const cache of cacheManagers) {
            const interval = setInterval(() => {
                const cleaned = cache.cleanup();
                if (cleaned > 0) {
                    // eslint-disable-next-line no-console
                    console.log(`Cache cleanup: removed ${cleaned} expired items`);
                }
            }, intervalMs);

            this.intervals.push(interval);
        }
    }

    /**
     * Stop periodic cache cleanup
     */
    stop(): void {
        for (const interval of this.intervals) {
            clearInterval(interval);
        }
        this.intervals = [];
    }
}

/**
 * Global cache cleanup scheduler
 */
export const globalCacheCleanupScheduler = new CacheCleanupScheduler(); 
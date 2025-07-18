/**
 * Simple in-memory cache with TTL support
 */
interface CacheEntry<T> {
    data: T;
    timestamp: number;
    ttl: number;
}

export class SimpleCache {
    private cache = new Map<string, CacheEntry<any>>();
    private defaultTTL = 5 * 60 * 1000; // 5 minutes

    /**
     * Get value from cache
     */
    get<T>(key: string): T | null {
        const entry = this.cache.get(key);
        if (!entry) return null;

        // Check if expired
        if (Date.now() - entry.timestamp > entry.ttl) {
            this.cache.delete(key);
            return null;
        }

        return entry.data;
    }

    /**
     * Set value in cache with optional TTL
     */
    set<T>(key: string, data: T, ttl?: number): void {
        this.cache.set(key, {
            data,
            timestamp: Date.now(),
            ttl: ttl || this.defaultTTL,
        });
    }

    /**
     * Delete value from cache
     */
    delete(key: string): void {
        this.cache.delete(key);
    }

    /**
     * Clear all cache entries
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * Get cache size
     */
    size(): number {
        return this.cache.size;
    }

    /**
     * Clean up expired entries
     */
    cleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > entry.ttl) {
                this.cache.delete(key);
            }
        }
    }

    /**
     * Get or set pattern - if value exists return it, otherwise compute and cache
     */
    async getOrSet<T>(
        key: string,
        factory: () => Promise<T> | T,
        ttl?: number
    ): Promise<T> {
        const cached = this.get<T>(key);
        if (cached !== null) {
            return cached;
        }

        const value = await factory();
        this.set(key, value, ttl);
        return value;
    }
}

// Cache instances for different data types
export const userCache = new SimpleCache();
export const creditCache = new SimpleCache();
export const apiCache = new SimpleCache();

// Default cache instance
export const cache = new SimpleCache();

// Cache key generators
export const cacheKeys = {
    userProfile: (uid: string) => `user:profile:${uid}`,
    userCredits: (uid: string) => `user:credits:${uid}`,
    userTransactions: (uid: string, page: number, limit: number) =>
        `user:transactions:${uid}:${page}:${limit}`,
    userExtended: (uid: string) => `user:extended:${uid}`,
};

// Cleanup expired entries every 10 minutes
if (typeof window !== 'undefined') {
    setInterval(() => {
        cache.cleanup();
        userCache.cleanup();
        creditCache.cleanup();
        apiCache.cleanup();
    }, 10 * 60 * 1000);
} 
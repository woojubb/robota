/**
 * Cache key identifying a unique LLM execution request
 */
export interface ICacheKey {
    /** SHA-256 hash of the serialized request */
    hash: string;
    /** Model identifier */
    model: string;
    /** Provider name */
    provider: string;
}

/**
 * Cached LLM response entry
 */
export interface ICacheEntry {
    /** Cache key that produced this entry */
    key: ICacheKey;
    /** Cached response content */
    response: string;
    /** When the entry was cached */
    timestamp: number;
    /** SHA-256 integrity hash of the response */
    integrityHash: string;
}

/**
 * Cache storage interface for pluggable backends
 */
export interface ICacheStorage {
    /** Retrieve a cached entry by key hash */
    get(hash: string): ICacheEntry | undefined;
    /** Store a cache entry */
    set(entry: ICacheEntry): void;
    /** Delete a cached entry by key hash */
    delete(hash: string): boolean;
    /** Clear all cached entries */
    clear(): void;
    /** Get cache statistics */
    getStats(): ICacheStats;
}

/**
 * Cache performance statistics
 */
export interface ICacheStats {
    /** Number of cache hits */
    hits: number;
    /** Number of cache misses */
    misses: number;
    /** Current number of cached entries */
    entries: number;
    /** Hit rate (hits / (hits + misses)), 0 if no lookups */
    hitRate: number;
}

/**
 * Configuration options for execution caching
 */
export interface ICacheOptions {
    /** Whether caching is enabled */
    enabled: boolean;
    /** Maximum number of cached entries */
    maxEntries: number;
    /** Time-to-live in milliseconds */
    ttlMs: number;
}

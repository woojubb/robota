import type { BasePluginOptions } from '../../abstracts/base-plugin';

/**
 * Rate limiting strategies
 */
export type LimitsStrategy = 'token-bucket' | 'sliding-window' | 'fixed-window' | 'none';

/**
 * Limits plugin configuration
 */
export interface LimitsPluginOptions extends BasePluginOptions {
    /** Rate limiting strategy */
    strategy: LimitsStrategy;
    /** Maximum tokens per time window */
    maxTokens?: number;
    /** Maximum requests per time window */
    maxRequests?: number;
    /** Time window in milliseconds */
    timeWindow?: number;
    /** Maximum cost per time window (in USD) */
    maxCost?: number;
    /** Token cost per 1000 tokens (in USD) */
    tokenCostPer1000?: number;
    /** Bucket refill rate for token bucket strategy */
    refillRate?: number;
    /** Initial bucket size for token bucket strategy */
    bucketSize?: number;
    /** Custom cost calculator */
    costCalculator?: (tokens: number, model: string) => number;
}

/**
 * Plugin limits status data type - supports nested objects and null values for comprehensive status reporting
 * 
 * REASON: Status data needs to include nested objects for bucket/window details and null values for missing data
 * ALTERNATIVES_CONSIDERED:
 * 1. Strict primitive types (loses nested status information)
 * 2. Union types without null (breaks null handling)
 * 3. Interface definitions (too rigid for dynamic status)
 * 4. Generic constraints (too complex for status data)
 * 5. Type assertions (decreases type safety)
 * TODO: Consider specific status interfaces if patterns emerge
 */
export type PluginLimitsStatusData = Record<string, string | number | boolean | Array<string | number | boolean> | Record<string, string | number | boolean> | null>;

/**
 * Rate limiting window data
 */
export interface LimitWindow {
    count: number;
    tokens: number;
    cost: number;
    windowStart: number;
}

/**
 * Token bucket state
 */
export interface TokenBucket {
    tokens: number;
    lastRefill: number;
    requests: number;
    cost: number;
    windowStart: number;
} 
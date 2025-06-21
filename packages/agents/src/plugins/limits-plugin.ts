import { BasePlugin } from '../abstracts/base-plugin.js';
import { Logger } from '../utils/logger.js';
import { PluginError } from '../utils/errors.js';

/**
 * Rate limiting strategies
 */
export type LimitsStrategy = 'token-bucket' | 'sliding-window' | 'fixed-window' | 'none';

/**
 * Limits plugin configuration
 */
export interface LimitsPluginOptions {
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
 * Rate limiting window data
 */
interface LimitWindow {
    count: number;
    tokens: number;
    cost: number;
    windowStart: number;
}

/**
 * Token bucket state
 */
interface TokenBucket {
    tokens: number;
    lastRefill: number;
    requests: number;
    cost: number;
    windowStart: number;
}

/**
 * Plugin for rate limiting and resource control
 * Enforces limits on token usage, request frequency, and costs
 */
export class LimitsPlugin extends BasePlugin {
    name = 'LimitsPlugin';
    version = '1.0.0';

    private options: Required<LimitsPluginOptions>;
    private logger: Logger;
    private windows = new Map<string, LimitWindow>();
    private buckets = new Map<string, TokenBucket>();
    private requestCounts = new Map<string, number>();

    constructor(options: LimitsPluginOptions) {
        super();
        this.logger = new Logger('LimitsPlugin');

        // Set defaults
        this.options = {
            strategy: options.strategy,
            maxTokens: options.maxTokens ?? 100000,
            maxRequests: options.maxRequests ?? 1000,
            timeWindow: options.timeWindow ?? 3600000, // 1 hour
            maxCost: options.maxCost ?? 10.0, // $10
            tokenCostPer1000: options.tokenCostPer1000 ?? 0.002, // $0.002 per 1K tokens
            refillRate: options.refillRate ?? 100, // tokens per second
            bucketSize: options.bucketSize ?? 10000,
            costCalculator: options.costCalculator ?? this.defaultCostCalculator.bind(this)
        };

        this.logger.info('LimitsPlugin initialized', {
            strategy: this.options.strategy,
            maxTokens: this.options.maxTokens,
            maxRequests: this.options.maxRequests,
            timeWindow: this.options.timeWindow
        });
    }

    /**
     * Check limits before execution
     */
    async beforeExecution(context: any): Promise<void> {
        if (this.options.strategy === 'none') {
            return;
        }

        const key = this.getKey(context);

        try {
            switch (this.options.strategy) {
                case 'token-bucket':
                    await this.checkTokenBucket(key, context);
                    break;
                case 'sliding-window':
                    await this.checkSlidingWindow(key, context);
                    break;
                case 'fixed-window':
                    await this.checkFixedWindow(key, context);
                    break;
            }

            this.logger.debug('Limits check passed', {
                strategy: this.options.strategy,
                key
            });

        } catch (error) {
            this.logger.warn('Limits check failed', {
                strategy: this.options.strategy,
                key,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Update limits after execution
     */
    async afterExecution(context: any, result: any): Promise<void> {
        if (this.options.strategy === 'none') {
            return;
        }

        const key = this.getKey(context);
        const tokensUsed = result?.tokensUsed || 0;
        const cost = this.options.costCalculator(tokensUsed, context.config?.model || 'unknown');

        try {
            switch (this.options.strategy) {
                case 'token-bucket':
                    this.updateTokenBucket(key, tokensUsed, cost);
                    break;
                case 'sliding-window':
                case 'fixed-window':
                    this.updateWindow(key, tokensUsed, cost);
                    break;
            }

            this.logger.debug('Limits updated after execution', {
                strategy: this.options.strategy,
                key,
                tokensUsed,
                cost
            });

        } catch (error) {
            this.logger.error('Failed to update limits', {
                strategy: this.options.strategy,
                key,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Token bucket rate limiting
     */
    private async checkTokenBucket(key: string, context: any): Promise<void> {
        const bucket = this.getBucket(key);
        const now = Date.now();

        // Refill bucket
        const timePassed = (now - bucket.lastRefill) / 1000;
        const tokensToAdd = timePassed * this.options.refillRate;
        bucket.tokens = Math.min(this.options.bucketSize, bucket.tokens + tokensToAdd);
        bucket.lastRefill = now;

        // Check if we can process this request
        const estimatedTokens = this.estimateTokens(context);
        if (bucket.tokens < estimatedTokens) {
            throw new PluginError(
                `Token bucket depleted. Available: ${Math.floor(bucket.tokens)}, Required: ${estimatedTokens}`,
                this.name,
                { availableTokens: bucket.tokens, requiredTokens: estimatedTokens }
            );
        }

        // Check time window limits for requests and cost
        if (now - bucket.windowStart >= this.options.timeWindow) {
            bucket.requests = 0;
            bucket.cost = 0;
            bucket.windowStart = now;
        }

        if (bucket.requests >= this.options.maxRequests) {
            throw new PluginError(
                `Request limit exceeded. Max: ${this.options.maxRequests}`,
                this.name,
                { currentRequests: bucket.requests, maxRequests: this.options.maxRequests }
            );
        }

        const estimatedCost = this.options.costCalculator(estimatedTokens, context.config?.model || 'unknown');
        if (bucket.cost + estimatedCost > this.options.maxCost) {
            throw new PluginError(
                `Cost limit exceeded. Current: $${bucket.cost.toFixed(4)}, Estimated: $${estimatedCost.toFixed(4)}, Max: $${this.options.maxCost}`,
                this.name,
                { currentCost: bucket.cost, estimatedCost, maxCost: this.options.maxCost }
            );
        }

        // Reserve tokens
        bucket.tokens -= estimatedTokens;
        bucket.requests++;
    }

    /**
     * Sliding window rate limiting
     */
    private async checkSlidingWindow(key: string, context: any): Promise<void> {
        const now = Date.now();
        const window = this.getWindow(key);

        // For sliding window, we track usage more granularly
        // This is a simplified implementation
        if (now - window.windowStart < this.options.timeWindow) {
            const estimatedTokens = this.estimateTokens(context);
            const estimatedCost = this.options.costCalculator(estimatedTokens, context.config?.model || 'unknown');

            if (window.tokens + estimatedTokens > this.options.maxTokens) {
                throw new PluginError(
                    `Token limit exceeded in sliding window. Current: ${window.tokens}, Estimated: ${estimatedTokens}, Max: ${this.options.maxTokens}`,
                    this.name,
                    { currentTokens: window.tokens, estimatedTokens, maxTokens: this.options.maxTokens }
                );
            }

            if (window.count >= this.options.maxRequests) {
                throw new PluginError(
                    `Request limit exceeded in sliding window. Current: ${window.count}, Max: ${this.options.maxRequests}`,
                    this.name,
                    { currentRequests: window.count, maxRequests: this.options.maxRequests }
                );
            }

            if (window.cost + estimatedCost > this.options.maxCost) {
                throw new PluginError(
                    `Cost limit exceeded in sliding window. Current: $${window.cost.toFixed(4)}, Estimated: $${estimatedCost.toFixed(4)}, Max: $${this.options.maxCost}`,
                    this.name,
                    { currentCost: window.cost, estimatedCost, maxCost: this.options.maxCost }
                );
            }
        } else {
            // Reset window
            window.count = 0;
            window.tokens = 0;
            window.cost = 0;
            window.windowStart = now;
        }

        window.count++;
    }

    /**
     * Fixed window rate limiting
     */
    private async checkFixedWindow(key: string, context: any): Promise<void> {
        const now = Date.now();
        const window = this.getWindow(key);

        // Reset window if expired
        if (now - window.windowStart >= this.options.timeWindow) {
            window.count = 0;
            window.tokens = 0;
            window.cost = 0;
            window.windowStart = now;
        }

        const estimatedTokens = this.estimateTokens(context);
        const estimatedCost = this.options.costCalculator(estimatedTokens, context.config?.model || 'unknown');

        if (window.tokens + estimatedTokens > this.options.maxTokens) {
            throw new PluginError(
                `Token limit exceeded in fixed window. Current: ${window.tokens}, Estimated: ${estimatedTokens}, Max: ${this.options.maxTokens}`,
                this.name,
                { currentTokens: window.tokens, estimatedTokens, maxTokens: this.options.maxTokens }
            );
        }

        if (window.count >= this.options.maxRequests) {
            throw new PluginError(
                `Request limit exceeded in fixed window. Current: ${window.count}, Max: ${this.options.maxRequests}`,
                this.name,
                { currentRequests: window.count, maxRequests: this.options.maxRequests }
            );
        }

        if (window.cost + estimatedCost > this.options.maxCost) {
            throw new PluginError(
                `Cost limit exceeded in fixed window. Current: $${window.cost.toFixed(4)}, Estimated: $${estimatedCost.toFixed(4)}, Max: $${this.options.maxCost}`,
                this.name,
                { currentCost: window.cost, estimatedCost, maxCost: this.options.maxCost }
            );
        }

        window.count++;
    }

    /**
     * Update token bucket after execution
     */
    private updateTokenBucket(key: string, tokensUsed: number, cost: number): void {
        const bucket = this.getBucket(key);
        bucket.cost += cost;
    }

    /**
     * Update window after execution
     */
    private updateWindow(key: string, tokensUsed: number, cost: number): void {
        const window = this.getWindow(key);
        window.tokens += tokensUsed;
        window.cost += cost;
    }

    /**
     * Get or create token bucket for key
     */
    private getBucket(key: string): TokenBucket {
        if (!this.buckets.has(key)) {
            this.buckets.set(key, {
                tokens: this.options.bucketSize,
                lastRefill: Date.now(),
                requests: 0,
                cost: 0,
                windowStart: Date.now()
            });
        }
        return this.buckets.get(key)!;
    }

    /**
     * Get or create window for key
     */
    private getWindow(key: string): LimitWindow {
        if (!this.windows.has(key)) {
            this.windows.set(key, {
                count: 0,
                tokens: 0,
                cost: 0,
                windowStart: Date.now()
            });
        }
        return this.windows.get(key)!;
    }

    /**
     * Generate key for rate limiting (user/session based)
     */
    private getKey(context: any): string {
        return context.userId || context.sessionId || context.executionId || 'default';
    }

    /**
     * Estimate tokens needed for request
     */
    private estimateTokens(context: any): number {
        // Simple estimation - in real implementation, this would be more sophisticated
        const messageLength = context.messages?.reduce((total: number, msg: any) =>
            total + (msg.content?.length || 0), 0) || 0;

        // Rough estimation: 1 token per 4 characters
        return Math.ceil(messageLength / 4) + 100; // Add some buffer
    }

    /**
     * Default cost calculator
     */
    private defaultCostCalculator(tokens: number, model: string): number {
        // Different models have different costs
        const modelCosts: Record<string, number> = {
            'gpt-4': 0.03,
            'gpt-4-turbo': 0.01,
            'gpt-3.5-turbo': 0.002,
            'claude-3-opus': 0.015,
            'claude-3-sonnet': 0.003,
            'claude-3-haiku': 0.00025
        };

        const costPer1000 = modelCosts[model] || this.options.tokenCostPer1000;
        return (tokens / 1000) * costPer1000;
    }

    /**
     * Get current limits status
     */
    getStatus(key?: string): Record<string, any> {
        if (key) {
            const bucket = this.buckets.get(key);
            const window = this.windows.get(key);

            return {
                strategy: this.options.strategy,
                key,
                bucket: bucket ? {
                    availableTokens: Math.floor(bucket.tokens),
                    requests: bucket.requests,
                    cost: bucket.cost
                } : null,
                window: window ? {
                    count: window.count,
                    tokens: window.tokens,
                    cost: window.cost,
                    windowStart: window.windowStart
                } : null
            };
        }

        return {
            strategy: this.options.strategy,
            totalKeys: this.buckets.size + this.windows.size,
            bucketKeys: Array.from(this.buckets.keys()),
            windowKeys: Array.from(this.windows.keys())
        };
    }

    /**
     * Reset limits for a key or all keys
     */
    resetLimits(key?: string): void {
        if (key) {
            this.buckets.delete(key);
            this.windows.delete(key);
            this.requestCounts.delete(key);
            this.logger.info('Limits reset for key', { key });
        } else {
            this.buckets.clear();
            this.windows.clear();
            this.requestCounts.clear();
            this.logger.info('All limits reset');
        }
    }
} 
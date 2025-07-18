import { BasePlugin, BaseExecutionContext, BaseExecutionResult, PluginCategory, PluginPriority } from '../abstracts/base-plugin';
import { Logger, createLogger } from '../utils/logger';
import { PluginError } from '../utils/errors';
import type {
    LimitsStrategy,
    LimitsPluginOptions,
    PluginLimitsStatusData,
    LimitWindow,
    TokenBucket
} from './limits/types';

// Re-export types for external use
export type { LimitsStrategy, LimitsPluginOptions, PluginLimitsStatusData };

/**
 * Reusable type definitions for limits plugin
 */

/**
 * Plugin execution context type
 * Used for processing execution context in limits plugin
 * Extends BaseExecutionContext for compatibility
 */
export interface PluginExecutionContext extends BaseExecutionContext {
    config?: {
        model?: string;
        maxTokens?: number;
        temperature?: number;
    };
    conversationId?: string;
}

/**
 * Plugin execution result type
 * Used for processing execution results in limits plugin
 */
export type PluginExecutionResult = {
    tokensUsed?: number;
    cost?: number;
    success?: boolean;
    [key: string]: string | number | boolean | undefined;
};

/**
 * Plugin for rate limiting and resource control
 * Enforces limits on token usage, request frequency, and costs
 */
export class LimitsPlugin extends BasePlugin<LimitsPluginOptions, PluginLimitsStatusData> {
    name = 'LimitsPlugin';
    version = '1.0.0';

    private pluginOptions: Required<LimitsPluginOptions>;
    private logger: Logger;
    private windows = new Map<string, LimitWindow>();
    private buckets = new Map<string, TokenBucket>();
    private requestCounts = new Map<string, number>();

    constructor(options: LimitsPluginOptions) {
        super();
        this.logger = createLogger('LimitsPlugin');

        // Validate options
        this.validateOptions(options);

        // Set defaults
        this.pluginOptions = {
            enabled: options.enabled ?? true,
            strategy: options.strategy,
            maxTokens: options.maxTokens ?? 100000,
            maxRequests: options.maxRequests ?? 1000,
            timeWindow: options.timeWindow ?? 3600000, // 1 hour
            maxCost: options.maxCost ?? 10.0, // $10
            tokenCostPer1000: options.tokenCostPer1000 ?? 0.002, // $0.002 per 1K tokens
            refillRate: options.refillRate ?? 100, // tokens per second
            bucketSize: options.bucketSize ?? 10000,
            costCalculator: options.costCalculator ?? this.defaultCostCalculator.bind(this),
            // Add BasePluginOptions defaults
            category: options.category ?? PluginCategory.LIMITS,
            priority: options.priority ?? PluginPriority.NORMAL,
            moduleEvents: options.moduleEvents ?? [],
            subscribeToAllModuleEvents: options.subscribeToAllModuleEvents ?? false
        };

        this.logger.info('LimitsPlugin initialized', {
            strategy: this.pluginOptions.strategy,
            maxTokens: this.pluginOptions.maxTokens,
            maxRequests: this.pluginOptions.maxRequests,
            timeWindow: this.pluginOptions.timeWindow
        });
    }

    /**
     * Check limits before execution
     */
    override async beforeExecution(context: BaseExecutionContext): Promise<void> {
        if (this.pluginOptions.strategy === 'none') {
            return;
        }

        const key = this.getKey(context);

        try {
            switch (this.pluginOptions.strategy) {
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
                strategy: this.pluginOptions.strategy,
                key
            });

        } catch (error) {
            this.logger.warn('Limits check failed', {
                strategy: this.pluginOptions.strategy,
                key,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Update limits after execution
     */
    override async afterExecution(context: BaseExecutionContext, result: BaseExecutionResult): Promise<void> {
        if (this.pluginOptions.strategy === 'none') {
            return;
        }

        const key = this.getKey(context);
        const tokensUsed = result?.tokensUsed || 0;
        const cost = this.pluginOptions.costCalculator(tokensUsed, (context.config?.['model'] as string) || 'unknown');

        try {
            switch (this.pluginOptions.strategy) {
                case 'token-bucket':
                    this.updateTokenBucket(key, tokensUsed, cost);
                    break;
                case 'sliding-window':
                case 'fixed-window':
                    this.updateWindow(key, tokensUsed, cost);
                    break;
            }

            this.logger.debug('Limits updated after execution', {
                strategy: this.pluginOptions.strategy,
                key,
                tokensUsed,
                cost
            });

        } catch (error) {
            this.logger.error('Failed to update limits', {
                strategy: this.pluginOptions.strategy,
                key,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Token bucket rate limiting
     */
    private async checkTokenBucket(key: string, context: PluginExecutionContext): Promise<void> {
        const bucket = this.getBucket(key);
        const now = Date.now();

        // Refill bucket
        const timePassed = (now - bucket.lastRefill) / 1000;
        const tokensToAdd = timePassed * this.pluginOptions.refillRate;
        bucket.tokens = Math.min(this.pluginOptions.bucketSize, bucket.tokens + tokensToAdd);
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
        if (now - bucket.windowStart >= this.pluginOptions.timeWindow) {
            bucket.requests = 0;
            bucket.cost = 0;
            bucket.windowStart = now;
        }

        if (bucket.requests >= this.pluginOptions.maxRequests) {
            throw new PluginError(
                `Request limit exceeded. Max: ${this.pluginOptions.maxRequests}`,
                this.name,
                { currentRequests: bucket.requests, maxRequests: this.pluginOptions.maxRequests }
            );
        }

        const estimatedCost = this.pluginOptions.costCalculator(estimatedTokens, context.config?.model || 'unknown');
        if (bucket.cost + estimatedCost > this.pluginOptions.maxCost) {
            throw new PluginError(
                `Cost limit exceeded. Current: $${bucket.cost.toFixed(4)}, Estimated: $${estimatedCost.toFixed(4)}, Max: $${this.pluginOptions.maxCost}`,
                this.name,
                { currentCost: bucket.cost, estimatedCost, maxCost: this.pluginOptions.maxCost }
            );
        }

        // Reserve tokens
        bucket.tokens -= estimatedTokens;
        bucket.requests++;
    }

    /**
     * Sliding window rate limiting
     */
    private async checkSlidingWindow(key: string, context: PluginExecutionContext): Promise<void> {
        const now = Date.now();
        const window = this.getWindow(key);

        // For sliding window, we track usage more granularly
        // This is a simplified implementation
        if (now - window.windowStart < this.pluginOptions.timeWindow) {
            const estimatedTokens = this.estimateTokens(context);
            const estimatedCost = this.pluginOptions.costCalculator(estimatedTokens, context.config?.model || 'unknown');

            if (window.tokens + estimatedTokens > this.pluginOptions.maxTokens) {
                throw new PluginError(
                    `Token limit exceeded in sliding window. Current: ${window.tokens}, Estimated: ${estimatedTokens}, Max: ${this.pluginOptions.maxTokens}`,
                    this.name,
                    { currentTokens: window.tokens, estimatedTokens, maxTokens: this.pluginOptions.maxTokens }
                );
            }

            if (window.count >= this.pluginOptions.maxRequests) {
                throw new PluginError(
                    `Request limit exceeded in sliding window. Current: ${window.count}, Max: ${this.pluginOptions.maxRequests}`,
                    this.name,
                    { currentRequests: window.count, maxRequests: this.pluginOptions.maxRequests }
                );
            }

            if (window.cost + estimatedCost > this.pluginOptions.maxCost) {
                throw new PluginError(
                    `Cost limit exceeded in sliding window. Current: $${window.cost.toFixed(4)}, Estimated: $${estimatedCost.toFixed(4)}, Max: $${this.pluginOptions.maxCost}`,
                    this.name,
                    { currentCost: window.cost, estimatedCost, maxCost: this.pluginOptions.maxCost }
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
    private async checkFixedWindow(key: string, context: PluginExecutionContext): Promise<void> {
        const now = Date.now();
        const window = this.getWindow(key);

        // Reset window if expired
        if (now - window.windowStart >= this.pluginOptions.timeWindow) {
            window.count = 0;
            window.tokens = 0;
            window.cost = 0;
            window.windowStart = now;
        }

        const estimatedTokens = this.estimateTokens(context);
        const estimatedCost = this.pluginOptions.costCalculator(estimatedTokens, context.config?.model || 'unknown');

        if (window.tokens + estimatedTokens > this.pluginOptions.maxTokens) {
            throw new PluginError(
                `Token limit exceeded in fixed window. Current: ${window.tokens}, Estimated: ${estimatedTokens}, Max: ${this.pluginOptions.maxTokens}`,
                this.name,
                { currentTokens: window.tokens, estimatedTokens, maxTokens: this.pluginOptions.maxTokens }
            );
        }

        if (window.count >= this.pluginOptions.maxRequests) {
            throw new PluginError(
                `Request limit exceeded in fixed window. Current: ${window.count}, Max: ${this.pluginOptions.maxRequests}`,
                this.name,
                { currentRequests: window.count, maxRequests: this.pluginOptions.maxRequests }
            );
        }

        if (window.cost + estimatedCost > this.pluginOptions.maxCost) {
            throw new PluginError(
                `Cost limit exceeded in fixed window. Current: $${window.cost.toFixed(4)}, Estimated: $${estimatedCost.toFixed(4)}, Max: $${this.pluginOptions.maxCost}`,
                this.name,
                { currentCost: window.cost, estimatedCost, maxCost: this.pluginOptions.maxCost }
            );
        }

        window.count++;
    }

    /**
     * Update token bucket after execution
     */
    private updateTokenBucket(key: string, _tokensUsed: number, cost: number): void {
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
                tokens: this.pluginOptions.bucketSize,
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
    private getKey(context: PluginExecutionContext): string {
        return context.userId || context.sessionId || context['executionId'] as string || 'default';
    }

    /**
     * Estimate tokens needed for request
     */
    private estimateTokens(context: PluginExecutionContext): number {
        // Simple estimation - in real implementation, this would be more sophisticated
        const messageLength = context.messages?.reduce((total: number, msg: { role: string; content: string }) =>
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

        const costPer1000 = modelCosts[model] || this.pluginOptions.tokenCostPer1000;
        return (tokens / 1000) * costPer1000;
    }

    /**
 * Validate plugin options
 */
    private validateOptions(options: LimitsPluginOptions): void {
        if (options.strategy === 'none') {
            this.logger.info('LimitsPlugin configured with "none" strategy - no rate limiting will be applied');
            return;
        }

        if (!options.strategy) {
            throw new PluginError(
                'Strategy must be specified for limits plugin. Use "none" to disable rate limiting, or choose from: token-bucket, sliding-window, fixed-window',
                this.name,
                { availableStrategies: ['none', 'token-bucket', 'sliding-window', 'fixed-window'] }
            );
        }

        const validStrategies = ['none', 'token-bucket', 'sliding-window', 'fixed-window'];
        if (!validStrategies.includes(options.strategy)) {
            throw new PluginError(
                `Invalid strategy "${options.strategy}". Must be one of: ${validStrategies.join(', ')}`,
                this.name,
                { provided: options.strategy, validStrategies }
            );
        }

        // Token bucket strategy validation
        if (options.strategy === 'token-bucket') {
            if (options.bucketSize !== undefined && options.bucketSize <= 0) {
                throw new PluginError(
                    'Bucket size must be positive for token-bucket strategy',
                    this.name,
                    { strategy: options.strategy, bucketSize: options.bucketSize }
                );
            }
            if (options.refillRate !== undefined && options.refillRate < 0) {
                throw new PluginError(
                    'Refill rate must be non-negative for token-bucket strategy',
                    this.name,
                    { strategy: options.strategy, refillRate: options.refillRate }
                );
            }
        }

        // Sliding/Fixed window strategy validation
        if (['sliding-window', 'fixed-window'].includes(options.strategy)) {
            if (options.timeWindow !== undefined && options.timeWindow <= 0) {
                throw new PluginError(
                    `Time window must be positive for ${options.strategy} strategy`,
                    this.name,
                    { strategy: options.strategy, timeWindow: options.timeWindow }
                );
            }
        }

        // Common validations for all strategies
        if (options.maxRequests !== undefined && options.maxRequests < 0) {
            throw new PluginError(
                'Max requests must be non-negative',
                this.name,
                { strategy: options.strategy, maxRequests: options.maxRequests }
            );
        }

        if (options.maxTokens !== undefined && options.maxTokens < 0) {
            throw new PluginError(
                'Max tokens must be non-negative',
                this.name,
                { strategy: options.strategy, maxTokens: options.maxTokens }
            );
        }

        if (options.maxCost !== undefined && options.maxCost < 0) {
            throw new PluginError(
                'Max cost must be non-negative',
                this.name,
                { strategy: options.strategy, maxCost: options.maxCost }
            );
        }

        if (options.tokenCostPer1000 !== undefined && options.tokenCostPer1000 < 0) {
            throw new PluginError(
                'Token cost per 1000 must be non-negative',
                this.name,
                { strategy: options.strategy, tokenCostPer1000: options.tokenCostPer1000 }
            );
        }
    }

    /**
     * Get current limits status
     * 
     * REASON: Limits status contains mixed data types (numbers, strings, arrays, objects) for comprehensive status reporting
     * ALTERNATIVES_CONSIDERED:
     * 1. Strict interface definitions (too rigid for dynamic status data)
     * 2. Union types (becomes unwieldy for status reporting)
     * 3. Generic constraints (too complex for status methods)
     * 4. Separate status types (breaks existing functionality)
     * 5. Type assertions (decreases type safety)
     * TODO: Consider specific status interface if patterns emerge
     */
    getLimitsStatus(key?: string): PluginLimitsStatusData {
        if (key) {
            const bucket = this.buckets.get(key);
            const window = this.windows.get(key);

            return {
                strategy: this.pluginOptions.strategy,
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
            strategy: this.pluginOptions.strategy,
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
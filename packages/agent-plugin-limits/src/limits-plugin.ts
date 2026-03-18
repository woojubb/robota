import {
  AbstractPlugin,
  type IPluginExecutionContext,
  type IPluginExecutionResult,
  PluginCategory,
  PluginPriority,
  createLogger,
  type ILogger,
  PluginError,
  type TUniversalMessage,
} from '@robota-sdk/agent-core';
import type {
  TLimitsStrategy,
  ILimitsPluginOptions,
  TPluginLimitsStatusData,
  ILimitWindow,
  ITokenBucket,
} from './types';
import { validateLimitsOptions } from './validation';

const DEFAULT_MAX_TOKENS = 100000;
const DEFAULT_MAX_REQUESTS = 1000;
const DEFAULT_TIME_WINDOW_MS = 3600000;
const DEFAULT_MAX_COST = 10.0;
const DEFAULT_TOKEN_COST_PER_1000 = 0.002;
const DEFAULT_REFILL_RATE = 100;
const DEFAULT_BUCKET_SIZE = 10000;
const MS_PER_SECOND = 1000;
const COST_DECIMAL_PLACES = 4;
const CHARS_PER_TOKEN = 4;
const TOKEN_ESTIMATE_BUFFER = 100;
const TOKENS_PER_COST_UNIT = 1000;

export type { TLimitsStrategy, ILimitsPluginOptions, TPluginLimitsStatusData };

export interface ILimitsPluginExecutionContext extends IPluginExecutionContext {
  config?: { model?: string; maxTokens?: number; temperature?: number };
  conversationId?: string;
}

export interface ILimitsPluginExecutionResult {
  tokensUsed?: number;
  cost?: number;
  success?: boolean;
  [key: string]: string | number | boolean | undefined;
}

/**
 * Enforces rate limiting on token usage, request frequency, and cost.
 * @extends AbstractPlugin
 */
export class LimitsPlugin extends AbstractPlugin<ILimitsPluginOptions> {
  name = 'LimitsPlugin';
  version = '1.0.0';
  private pluginOptions: Required<ILimitsPluginOptions>;
  private logger: ILogger;
  private windows = new Map<string, ILimitWindow>();
  private buckets = new Map<string, ITokenBucket>();

  constructor(options: ILimitsPluginOptions) {
    super();
    this.logger = createLogger('LimitsPlugin');
    validateLimitsOptions(options, this.name, this.logger);
    this.pluginOptions = {
      enabled: options.enabled ?? true,
      strategy: options.strategy,
      maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      maxRequests: options.maxRequests ?? DEFAULT_MAX_REQUESTS,
      timeWindow: options.timeWindow ?? DEFAULT_TIME_WINDOW_MS,
      maxCost: options.maxCost ?? DEFAULT_MAX_COST,
      tokenCostPer1000: options.tokenCostPer1000 ?? DEFAULT_TOKEN_COST_PER_1000,
      refillRate: options.refillRate ?? DEFAULT_REFILL_RATE,
      bucketSize: options.bucketSize ?? DEFAULT_BUCKET_SIZE,
      costCalculator: options.costCalculator ?? this.defaultCostCalculator.bind(this),
      category: options.category ?? PluginCategory.LIMITS,
      priority: options.priority ?? PluginPriority.NORMAL,
      moduleEvents: options.moduleEvents ?? [],
      subscribeToAllModuleEvents: options.subscribeToAllModuleEvents ?? false,
    };
  }

  override async beforeExecution(context: IPluginExecutionContext): Promise<void> {
    if (this.pluginOptions.strategy === 'none') return;
    const key = this.getKey(context);
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
  }

  override async afterExecution(
    context: IPluginExecutionContext,
    result: IPluginExecutionResult,
  ): Promise<void> {
    if (this.pluginOptions.strategy === 'none') return;
    const key = this.getKey(context);
    const tokensUsed = result?.tokensUsed || 0;
    const cost = this.pluginOptions.costCalculator(tokensUsed, this.resolveModelName(context));
    switch (this.pluginOptions.strategy) {
      case 'token-bucket':
        this.updateTokenBucket(key, cost);
        break;
      case 'sliding-window':
      case 'fixed-window':
        this.updateWindow(key, tokensUsed, cost);
        break;
    }
  }

  private async checkTokenBucket(
    key: string,
    context: ILimitsPluginExecutionContext,
  ): Promise<void> {
    const bucket = this.getBucket(key);
    const now = Date.now();
    const timePassed = (now - bucket.lastRefill) / MS_PER_SECOND;
    bucket.tokens = Math.min(
      this.pluginOptions.bucketSize,
      bucket.tokens + timePassed * this.pluginOptions.refillRate,
    );
    bucket.lastRefill = now;
    const est = this.estimateTokens(context);
    if (bucket.tokens < est)
      throw new PluginError(
        `Token bucket depleted. Available: ${Math.floor(bucket.tokens)}, Required: ${est}`,
        this.name,
        { availableTokens: bucket.tokens, requiredTokens: est },
      );
    if (now - bucket.windowStart >= this.pluginOptions.timeWindow) {
      bucket.requests = 0;
      bucket.cost = 0;
      bucket.windowStart = now;
    }
    if (bucket.requests >= this.pluginOptions.maxRequests)
      throw new PluginError(
        `Request limit exceeded. Max: ${this.pluginOptions.maxRequests}`,
        this.name,
        { currentRequests: bucket.requests, maxRequests: this.pluginOptions.maxRequests },
      );
    const estCost = this.pluginOptions.costCalculator(est, this.resolveModelName(context));
    if (bucket.cost + estCost > this.pluginOptions.maxCost)
      throw new PluginError(
        `Cost limit exceeded. Current: $${bucket.cost.toFixed(COST_DECIMAL_PLACES)}, Estimated: $${estCost.toFixed(COST_DECIMAL_PLACES)}, Max: $${this.pluginOptions.maxCost}`,
        this.name,
        { currentCost: bucket.cost, estimatedCost: estCost, maxCost: this.pluginOptions.maxCost },
      );
    bucket.tokens -= est;
    bucket.requests++;
  }

  private async checkSlidingWindow(
    key: string,
    context: ILimitsPluginExecutionContext,
  ): Promise<void> {
    const now = Date.now();
    const window = this.getWindow(key);
    if (now - window.windowStart < this.pluginOptions.timeWindow) {
      const est = this.estimateTokens(context);
      const estCost = this.pluginOptions.costCalculator(est, this.resolveModelName(context));
      if (window.tokens + est > this.pluginOptions.maxTokens)
        throw new PluginError(
          `Token limit exceeded in sliding window. Current: ${window.tokens}, Estimated: ${est}, Max: ${this.pluginOptions.maxTokens}`,
          this.name,
          {
            currentTokens: window.tokens,
            estimatedTokens: est,
            maxTokens: this.pluginOptions.maxTokens,
          },
        );
      if (window.count >= this.pluginOptions.maxRequests)
        throw new PluginError(
          `Request limit exceeded in sliding window. Current: ${window.count}, Max: ${this.pluginOptions.maxRequests}`,
          this.name,
          { currentRequests: window.count, maxRequests: this.pluginOptions.maxRequests },
        );
      if (window.cost + estCost > this.pluginOptions.maxCost)
        throw new PluginError(
          `Cost limit exceeded in sliding window. Current: $${window.cost.toFixed(COST_DECIMAL_PLACES)}, Estimated: $${estCost.toFixed(COST_DECIMAL_PLACES)}, Max: $${this.pluginOptions.maxCost}`,
          this.name,
          { currentCost: window.cost, estimatedCost: estCost, maxCost: this.pluginOptions.maxCost },
        );
    } else {
      window.count = 0;
      window.tokens = 0;
      window.cost = 0;
      window.windowStart = now;
    }
    window.count++;
  }

  private async checkFixedWindow(
    key: string,
    context: ILimitsPluginExecutionContext,
  ): Promise<void> {
    const now = Date.now();
    const window = this.getWindow(key);
    if (now - window.windowStart >= this.pluginOptions.timeWindow) {
      window.count = 0;
      window.tokens = 0;
      window.cost = 0;
      window.windowStart = now;
    }
    const est = this.estimateTokens(context);
    const estCost = this.pluginOptions.costCalculator(est, this.resolveModelName(context));
    if (window.tokens + est > this.pluginOptions.maxTokens)
      throw new PluginError(
        `Token limit exceeded in fixed window. Current: ${window.tokens}, Estimated: ${est}, Max: ${this.pluginOptions.maxTokens}`,
        this.name,
        {
          currentTokens: window.tokens,
          estimatedTokens: est,
          maxTokens: this.pluginOptions.maxTokens,
        },
      );
    if (window.count >= this.pluginOptions.maxRequests)
      throw new PluginError(
        `Request limit exceeded in fixed window. Current: ${window.count}, Max: ${this.pluginOptions.maxRequests}`,
        this.name,
        { currentRequests: window.count, maxRequests: this.pluginOptions.maxRequests },
      );
    if (window.cost + estCost > this.pluginOptions.maxCost)
      throw new PluginError(
        `Cost limit exceeded in fixed window. Current: $${window.cost.toFixed(COST_DECIMAL_PLACES)}, Estimated: $${estCost.toFixed(COST_DECIMAL_PLACES)}, Max: $${this.pluginOptions.maxCost}`,
        this.name,
        { currentCost: window.cost, estimatedCost: estCost, maxCost: this.pluginOptions.maxCost },
      );
    window.count++;
  }

  private updateTokenBucket(key: string, cost: number): void {
    this.getBucket(key).cost += cost;
  }
  private updateWindow(key: string, tokensUsed: number, cost: number): void {
    const w = this.getWindow(key);
    w.tokens += tokensUsed;
    w.cost += cost;
  }
  private getBucket(key: string): ITokenBucket {
    if (!this.buckets.has(key))
      this.buckets.set(key, {
        tokens: this.pluginOptions.bucketSize,
        lastRefill: Date.now(),
        requests: 0,
        cost: 0,
        windowStart: Date.now(),
      });
    return this.buckets.get(key)!;
  }
  private getWindow(key: string): ILimitWindow {
    if (!this.windows.has(key))
      this.windows.set(key, { count: 0, tokens: 0, cost: 0, windowStart: Date.now() });
    return this.windows.get(key)!;
  }
  private getKey(context: ILimitsPluginExecutionContext): string {
    return context.userId || context.sessionId || context.executionId || 'default';
  }
  private resolveModelName(context: IPluginExecutionContext): string {
    const m = context.config?.model;
    return typeof m === 'string' && m.length > 0 ? m : 'unknown';
  }
  private estimateTokens(context: ILimitsPluginExecutionContext): number {
    return (
      Math.ceil(
        (context.messages?.reduce(
          (t: number, m: TUniversalMessage) => t + (m.content?.length || 0),
          0,
        ) || 0) / CHARS_PER_TOKEN,
      ) + TOKEN_ESTIMATE_BUFFER
    );
  }
  private defaultCostCalculator(tokens: number, model: string): number {
    const costs: Record<string, number> = {
      'gpt-4': 0.03,
      'gpt-4-turbo': 0.01,
      'gpt-3.5-turbo': 0.002,
      'claude-3-opus': 0.015,
      'claude-3-sonnet': 0.003,
      'claude-3-haiku': 0.00025,
    };
    return (tokens / TOKENS_PER_COST_UNIT) * (costs[model] || this.pluginOptions.tokenCostPer1000);
  }

  getLimitsStatus(key?: string): TPluginLimitsStatusData {
    if (key) {
      const bucket = this.buckets.get(key);
      const window = this.windows.get(key);
      return {
        strategy: this.pluginOptions.strategy,
        key,
        bucket: bucket
          ? {
              availableTokens: Math.floor(bucket.tokens),
              requests: bucket.requests,
              cost: bucket.cost,
            }
          : null,
        window: window
          ? {
              count: window.count,
              tokens: window.tokens,
              cost: window.cost,
              windowStart: window.windowStart,
            }
          : null,
      };
    }
    return {
      strategy: this.pluginOptions.strategy,
      totalKeys: this.buckets.size + this.windows.size,
      bucketKeys: Array.from(this.buckets.keys()),
      windowKeys: Array.from(this.windows.keys()),
    };
  }

  resetLimits(key?: string): void {
    if (key) {
      this.buckets.delete(key);
      this.windows.delete(key);
    } else {
      this.buckets.clear();
      this.windows.clear();
    }
  }
}

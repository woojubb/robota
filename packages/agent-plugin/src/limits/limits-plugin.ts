import {
  AbstractPlugin,
  type IPluginExecutionContext,
  type IPluginExecutionResult,
  PluginCategory,
  PluginPriority,
  PluginError,
  calculateModelCost,
  createLogger,
  type ILogger,
  type TUniversalMessage,
} from '@robota-sdk/agent-core';

import {
  defaultCostCalculator,
  estimateTokensFromMessages,
  checkTokenBucket,
  checkSlidingWindow,
  checkFixedWindow,
} from './limits-helpers';
import { validateLimitsOptions } from './validation';

import type {
  TLimitsStrategy,
  ILimitsPluginOptions,
  TPluginLimitsStatusData,
  ILimitWindow,
  ITokenBucket,
} from './types';

const DEFAULT_MAX_TOKENS = 100000;
const DEFAULT_MAX_REQUESTS = 1000;
const DEFAULT_TIME_WINDOW_MS = 3600000;
const DEFAULT_MAX_COST = 10.0;
const DEFAULT_TOKEN_COST_PER_1000 = 0.002;
const DEFAULT_REFILL_RATE = 100;
const DEFAULT_BUCKET_SIZE = 10000;

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
  /** SELFHOST-004: per-run cumulative EXACT cost (USD) keyed by run (sessionId); never time-resets. */
  private runCosts = new Map<string, number>();

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
      // No per-run cap unless configured: +Infinity is never exceeded (feature opt-in).
      maxRunCost: options.maxRunCost ?? Number.POSITIVE_INFINITY,
      tokenCostPer1000: options.tokenCostPer1000 ?? DEFAULT_TOKEN_COST_PER_1000,
      refillRate: options.refillRate ?? DEFAULT_REFILL_RATE,
      bucketSize: options.bucketSize ?? DEFAULT_BUCKET_SIZE,
      costCalculator:
        options.costCalculator ??
        ((tokens: number, model: string) =>
          defaultCostCalculator(tokens, model, this.pluginOptions.tokenCostPer1000)),
      category: options.category ?? PluginCategory.LIMITS,
      priority: options.priority ?? PluginPriority.NORMAL,
      moduleEvents: options.moduleEvents ?? [],
      subscribeToAllModuleEvents: options.subscribeToAllModuleEvents ?? false,
    };
  }

  override async beforeExecution(context: IPluginExecutionContext): Promise<void> {
    // SELFHOST-004: the per-run cumulative cap is orthogonal to the time-window strategy — it halts
    // the NEXT turn once the run's accrued cost has exceeded the budget (checked before 'none' returns).
    this.enforceRunBudget(context);
    if (this.pluginOptions.strategy === 'none') return;
    const key = this.getKey(context);
    const now = Date.now();
    const est = estimateTokensFromMessages(context.messages ?? []);
    const estCost = this.pluginOptions.costCalculator(est, this.resolveModelName(context));

    switch (this.pluginOptions.strategy) {
      case 'token-bucket':
        checkTokenBucket(this.getBucket(key), now, est, estCost, this.pluginOptions, this.name);
        break;
      case 'sliding-window':
        checkSlidingWindow(this.getWindow(key), now, est, estCost, this.pluginOptions, this.name);
        break;
      case 'fixed-window':
        checkFixedWindow(this.getWindow(key), now, est, estCost, this.pluginOptions, this.name);
        break;
    }
  }

  override async afterExecution(
    context: IPluginExecutionContext,
    result: IPluginExecutionResult,
  ): Promise<void> {
    // SELFHOST-004: accrue this turn's EXACT cost to the run budget first (orthogonal to the strategy).
    this.accrueRunCost(context, result);
    if (this.pluginOptions.strategy === 'none') return;
    const key = this.getKey(context);
    const tokensUsed = result?.tokensUsed || 0;
    const cost = this.pluginOptions.costCalculator(tokensUsed, this.resolveModelName(context));
    switch (this.pluginOptions.strategy) {
      case 'token-bucket':
        this.getBucket(key).cost += cost;
        break;
      case 'sliding-window':
      case 'fixed-window': {
        const w = this.getWindow(key);
        w.tokens += tokensUsed;
        w.cost += cost;
        break;
      }
    }
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

  /**
   * SELFHOST-004: the run key is the interactive session (`sessionId`) — NOT `userId`, which groups the
   * time-windows. A "run" is one session; its cumulative budget spans every turn until `resetLimits`.
   */
  private getRunKey(context: ILimitsPluginExecutionContext): string {
    return context.sessionId || context.executionId || 'default';
  }

  /**
   * SELFHOST-004: halt (throw) when the run's already-accrued cumulative cost has reached the per-run
   * budget cap — blocking the next turn. No-op when the cap is unset (+Infinity).
   */
  private enforceRunBudget(context: ILimitsPluginExecutionContext): void {
    if (!Number.isFinite(this.pluginOptions.maxRunCost)) return;
    const runKey = this.getRunKey(context);
    const accrued = this.runCosts.get(runKey) ?? 0;
    if (accrued >= this.pluginOptions.maxRunCost) {
      throw new PluginError(
        `Per-run budget exhausted. Run: ${runKey}, spent: $${accrued.toFixed(4)}, max: $${this.pluginOptions.maxRunCost}`,
        this.name,
        { runKey, accrued, maxRunCost: this.pluginOptions.maxRunCost },
      );
    }
  }

  /**
   * SELFHOST-004: accrue this turn's EXACT cost to the run budget, using the SAME `calculateModelCost`
   * SSOT (exact input/output split) that produces the displayed `costUsd` — so the enforced and
   * displayed figures share ONE computation path (never the blended estimate). Unpriced turns (no
   * model price) accrue nothing, mirroring `costStatus: 'unknown'`. Warns on crossing the cap.
   */
  private accrueRunCost(
    context: ILimitsPluginExecutionContext,
    result: IPluginExecutionResult,
  ): void {
    if (!Number.isFinite(this.pluginOptions.maxRunCost)) return;
    const usage = result.usage;
    if (!usage) return;
    const exact = calculateModelCost(
      this.resolveModelName(context),
      usage.promptTokens ?? 0,
      usage.completionTokens ?? 0,
    );
    if (exact === undefined) return; // unpriced model — cannot enforce an exact budget

    const runKey = this.getRunKey(context);
    const before = this.runCosts.get(runKey) ?? 0;
    const after = before + exact;
    this.runCosts.set(runKey, after);
    if (before < this.pluginOptions.maxRunCost && after >= this.pluginOptions.maxRunCost) {
      this.logger.warn?.(
        `[LimitsPlugin] Per-run budget reached for ${runKey}: $${after.toFixed(4)} of $${this.pluginOptions.maxRunCost}`,
      );
    }
  }

  private resolveModelName(context: IPluginExecutionContext): string {
    const m = context.config?.model;
    return typeof m === 'string' && m.length > 0 ? m : 'unknown';
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
        // SELFHOST-004: the run's cumulative budget spend (USD) for this key, and its cap.
        runCost: this.runCosts.get(key) ?? 0,
        maxRunCost: Number.isFinite(this.pluginOptions.maxRunCost)
          ? this.pluginOptions.maxRunCost
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
      // SELFHOST-004: run-start reset — clear the run's cumulative budget so a new run starts at $0.
      this.runCosts.delete(key);
    } else {
      this.buckets.clear();
      this.windows.clear();
      this.runCosts.clear();
    }
  }

  /** SELFHOST-004: the run's accrued cumulative cost (USD) so far, 0 if none/unknown. */
  getRunCost(key: string): number {
    return this.runCosts.get(key) ?? 0;
  }
}

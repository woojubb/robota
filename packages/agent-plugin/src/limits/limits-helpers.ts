/**
 * Limits Plugin - Rate limit check, cost calculation, and utility helpers.
 *
 * Extracted from limits-plugin.ts to keep each file under 300 lines.
 * @internal
 */

import { PluginError } from '@robota-sdk/agent-core';
import type { TUniversalMessage } from '@robota-sdk/agent-core';
import type { ILimitWindow, ITokenBucket } from './types';

const COST_DECIMAL_PLACES = 4;
const CHARS_PER_TOKEN = 4;
const TOKEN_ESTIMATE_BUFFER = 100;
const TOKENS_PER_COST_UNIT = 1000;
const MS_PER_SECOND = 1000;

/** Model-specific cost table (per 1000 tokens). @internal */
const MODEL_COSTS: Record<string, number> = {
  'gpt-4': 0.03,
  'gpt-4-turbo': 0.01,
  'gpt-3.5-turbo': 0.002,
  'claude-3-opus': 0.015,
  'claude-3-sonnet': 0.003,
  'claude-3-haiku': 0.00025,
};

/** Default cost calculator: uses model-specific rates or falls back to tokenCostPer1000. @internal */
export function defaultCostCalculator(
  tokens: number,
  model: string,
  tokenCostPer1000: number,
): number {
  return (tokens / TOKENS_PER_COST_UNIT) * (MODEL_COSTS[model] ?? tokenCostPer1000);
}

/** Estimate token count from message content lengths. @internal */
export function estimateTokensFromMessages(messages: TUniversalMessage[]): number {
  return (
    Math.ceil(messages.reduce((t, m) => t + (m.content?.length || 0), 0) / CHARS_PER_TOKEN) +
    TOKEN_ESTIMATE_BUFFER
  );
}

/** Check and update token-bucket state. Throws PluginError if any limit is exceeded. @internal */
export function checkTokenBucket(
  bucket: ITokenBucket,
  now: number,
  estimatedTokens: number,
  estimatedCost: number,
  options: {
    bucketSize: number;
    refillRate: number;
    timeWindow: number;
    maxRequests: number;
    maxCost: number;
  },
  pluginName: string,
): void {
  const timePassed = (now - bucket.lastRefill) / MS_PER_SECOND;
  bucket.tokens = Math.min(options.bucketSize, bucket.tokens + timePassed * options.refillRate);
  bucket.lastRefill = now;

  if (bucket.tokens < estimatedTokens) {
    throw new PluginError(
      `Token bucket depleted. Available: ${Math.floor(bucket.tokens)}, Required: ${estimatedTokens}`,
      pluginName,
      { availableTokens: bucket.tokens, requiredTokens: estimatedTokens },
    );
  }

  if (now - bucket.windowStart >= options.timeWindow) {
    bucket.requests = 0;
    bucket.cost = 0;
    bucket.windowStart = now;
  }

  if (bucket.requests >= options.maxRequests) {
    throw new PluginError(`Request limit exceeded. Max: ${options.maxRequests}`, pluginName, {
      currentRequests: bucket.requests,
      maxRequests: options.maxRequests,
    });
  }

  if (bucket.cost + estimatedCost > options.maxCost) {
    throw new PluginError(
      `Cost limit exceeded. Current: $${bucket.cost.toFixed(COST_DECIMAL_PLACES)}, Estimated: $${estimatedCost.toFixed(COST_DECIMAL_PLACES)}, Max: $${options.maxCost}`,
      pluginName,
      { currentCost: bucket.cost, estimatedCost, maxCost: options.maxCost },
    );
  }

  bucket.tokens -= estimatedTokens;
  bucket.requests++;
}

/** Check and update sliding-window state. Throws PluginError if any limit is exceeded. @internal */
export function checkSlidingWindow(
  window: ILimitWindow,
  now: number,
  estimatedTokens: number,
  estimatedCost: number,
  options: {
    timeWindow: number;
    maxTokens: number;
    maxRequests: number;
    maxCost: number;
  },
  pluginName: string,
): void {
  if (now - window.windowStart < options.timeWindow) {
    if (window.tokens + estimatedTokens > options.maxTokens) {
      throw new PluginError(
        `Token limit exceeded in sliding window. Current: ${window.tokens}, Estimated: ${estimatedTokens}, Max: ${options.maxTokens}`,
        pluginName,
        { currentTokens: window.tokens, estimatedTokens, maxTokens: options.maxTokens },
      );
    }
    if (window.count >= options.maxRequests) {
      throw new PluginError(
        `Request limit exceeded in sliding window. Current: ${window.count}, Max: ${options.maxRequests}`,
        pluginName,
        { currentRequests: window.count, maxRequests: options.maxRequests },
      );
    }
    if (window.cost + estimatedCost > options.maxCost) {
      throw new PluginError(
        `Cost limit exceeded in sliding window. Current: $${window.cost.toFixed(COST_DECIMAL_PLACES)}, Estimated: $${estimatedCost.toFixed(COST_DECIMAL_PLACES)}, Max: $${options.maxCost}`,
        pluginName,
        { currentCost: window.cost, estimatedCost, maxCost: options.maxCost },
      );
    }
  } else {
    window.count = 0;
    window.tokens = 0;
    window.cost = 0;
    window.windowStart = now;
  }
  window.count++;
}

/** Check and update fixed-window state. Throws PluginError if any limit is exceeded. @internal */
export function checkFixedWindow(
  window: ILimitWindow,
  now: number,
  estimatedTokens: number,
  estimatedCost: number,
  options: {
    timeWindow: number;
    maxTokens: number;
    maxRequests: number;
    maxCost: number;
  },
  pluginName: string,
): void {
  if (now - window.windowStart >= options.timeWindow) {
    window.count = 0;
    window.tokens = 0;
    window.cost = 0;
    window.windowStart = now;
  }

  if (window.tokens + estimatedTokens > options.maxTokens) {
    throw new PluginError(
      `Token limit exceeded in fixed window. Current: ${window.tokens}, Estimated: ${estimatedTokens}, Max: ${options.maxTokens}`,
      pluginName,
      { currentTokens: window.tokens, estimatedTokens, maxTokens: options.maxTokens },
    );
  }
  if (window.count >= options.maxRequests) {
    throw new PluginError(
      `Request limit exceeded in fixed window. Current: ${window.count}, Max: ${options.maxRequests}`,
      pluginName,
      { currentRequests: window.count, maxRequests: options.maxRequests },
    );
  }
  if (window.cost + estimatedCost > options.maxCost) {
    throw new PluginError(
      `Cost limit exceeded in fixed window. Current: $${window.cost.toFixed(COST_DECIMAL_PLACES)}, Estimated: $${estimatedCost.toFixed(COST_DECIMAL_PLACES)}, Max: $${options.maxCost}`,
      pluginName,
      { currentCost: window.cost, estimatedCost, maxCost: options.maxCost },
    );
  }
  window.count++;
}

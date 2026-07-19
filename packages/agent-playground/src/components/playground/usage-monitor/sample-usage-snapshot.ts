import {
  SAMPLE_DAY_LIMIT,
  SAMPLE_DAY_RESET_MS,
  SAMPLE_HOUR_LIMIT,
  SAMPLE_HOUR_RESET_MS,
  SAMPLE_MAX_DAILY_EXECUTIONS,
  SAMPLE_MAX_RANDOM_EXECUTIONS,
  SAMPLE_MAX_RANDOM_TOKENS,
  SAMPLE_MAX_TOKENS,
  SAMPLE_MINUTE_LIMIT,
  SAMPLE_MINUTE_RESET_MS,
} from './constants';
import type { IRateLimitWindow, IPlaygroundUsageSnapshot } from './types';

function createRateLimitWindow(limit: number, resetOffsetMs: number): IRateLimitWindow {
  return {
    remaining: Math.floor(Math.random() * limit),
    limit,
    resetTime: new Date(Date.now() + resetOffsetMs).toISOString(),
  };
}

export function createSampleUsageSnapshot(): IPlaygroundUsageSnapshot {
  return {
    usage: {
      dailyExecutions: SAMPLE_MAX_DAILY_EXECUTIONS,
      maxConcurrentSessions: 1,
      allowedProviders: ['openai'],
      maxTokens: SAMPLE_MAX_TOKENS,
      currentUsage: {
        dailyExecutions: Math.floor(Math.random() * SAMPLE_MAX_RANDOM_EXECUTIONS),
        activeSessions: Math.floor(Math.random() * 2),
        tokensUsed: Math.floor(Math.random() * SAMPLE_MAX_RANDOM_TOKENS),
      },
      features: {
        streaming: false,
        tools: false,
        customTemplates: false,
      },
    },
    rateLimit: {
      minute: createRateLimitWindow(SAMPLE_MINUTE_LIMIT, SAMPLE_MINUTE_RESET_MS),
      hour: createRateLimitWindow(SAMPLE_HOUR_LIMIT, SAMPLE_HOUR_RESET_MS),
      day: createRateLimitWindow(SAMPLE_DAY_LIMIT, SAMPLE_DAY_RESET_MS),
    },
  };
}

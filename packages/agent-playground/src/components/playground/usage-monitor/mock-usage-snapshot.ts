import {
  MOCK_DAY_LIMIT,
  MOCK_DAY_RESET_MS,
  MOCK_HOUR_LIMIT,
  MOCK_HOUR_RESET_MS,
  MOCK_MAX_DAILY_EXECUTIONS,
  MOCK_MAX_RANDOM_EXECUTIONS,
  MOCK_MAX_RANDOM_TOKENS,
  MOCK_MAX_TOKENS,
  MOCK_MINUTE_LIMIT,
  MOCK_MINUTE_RESET_MS,
} from './constants';
import type { IRateLimitWindow, IUsageSnapshot } from './types';

function createRateLimitWindow(limit: number, resetOffsetMs: number): IRateLimitWindow {
  return {
    remaining: Math.floor(Math.random() * limit),
    limit,
    resetTime: new Date(Date.now() + resetOffsetMs).toISOString(),
  };
}

export function createMockUsageSnapshot(): IUsageSnapshot {
  return {
    usage: {
      dailyExecutions: MOCK_MAX_DAILY_EXECUTIONS,
      maxConcurrentSessions: 1,
      allowedProviders: ['openai'],
      maxTokens: MOCK_MAX_TOKENS,
      currentUsage: {
        dailyExecutions: Math.floor(Math.random() * MOCK_MAX_RANDOM_EXECUTIONS),
        activeSessions: Math.floor(Math.random() * 2),
        tokensUsed: Math.floor(Math.random() * MOCK_MAX_RANDOM_TOKENS),
      },
      features: {
        streaming: false,
        tools: false,
        customTemplates: false,
      },
    },
    rateLimit: {
      minute: createRateLimitWindow(MOCK_MINUTE_LIMIT, MOCK_MINUTE_RESET_MS),
      hour: createRateLimitWindow(MOCK_HOUR_LIMIT, MOCK_HOUR_RESET_MS),
      day: createRateLimitWindow(MOCK_DAY_LIMIT, MOCK_DAY_RESET_MS),
    },
  };
}

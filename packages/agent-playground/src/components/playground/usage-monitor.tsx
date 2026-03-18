'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Progress } from '../ui/progress';
import { Button } from '../ui/button';
import {
  Activity,
  Clock,
  Zap,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  TrendingUp,
  Users,
} from 'lucide-react';
import { WebLogger } from '../../lib/web-logger';

interface IPlaygroundUsageStats {
  dailyExecutions: number;
  maxConcurrentSessions: number;
  allowedProviders: string[];
  maxTokens: number;
  currentUsage: {
    dailyExecutions: number;
    activeSessions: number;
    tokensUsed: number;
  };
  features: {
    streaming: boolean;
    tools: boolean;
    customTemplates: boolean;
  };
}

interface IRateLimitInfo {
  minute: { remaining: number; limit: number; resetTime: string };
  hour: { remaining: number; limit: number; resetTime: string };
  day: { remaining: number; limit: number; resetTime: string };
}

const REFRESH_INTERVAL_MS = 30000;
const FETCH_DELAY_MS = 500;
const MOCK_MAX_DAILY_EXECUTIONS = 100;
const MOCK_MAX_TOKENS = 1000;
const MOCK_MAX_RANDOM_EXECUTIONS = 15;
const MOCK_MINUTE_LIMIT = 5;
const MOCK_HOUR_LIMIT = 50;
const MOCK_DAY_LIMIT = 100;
const MOCK_MINUTE_RESET_MS = 30000;
const MOCK_HOUR_RESET_MS = 1800000;
const MOCK_DAY_RESET_MS = 86400000;
const PERCENTAGE_MULTIPLIER = 100;
const USAGE_WARNING_THRESHOLD = 90;
const USAGE_CAUTION_THRESHOLD = 70;
const MOCK_MAX_RANDOM_TOKENS = 300;

interface IUsageMonitorProps {
  isVisible: boolean;
  onClose?: () => void;
}

export function UsageMonitor({ isVisible, onClose }: IUsageMonitorProps) {
  const [usage, setUsage] = useState<IPlaygroundUsageStats | null>(null);
  const [rateLimit, setRateLimit] = useState<IRateLimitInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  useEffect(() => {
    if (isVisible) {
      fetchUsageStats();
      // Refresh periodically when visible
      const interval = setInterval(fetchUsageStats, REFRESH_INTERVAL_MS);
      return () => clearInterval(interval);
    }
    return;
  }, [isVisible]);

  const fetchUsageStats = async () => {
    setIsLoading(true);
    try {
      // This would call the actual API in production
      // For now, we'll simulate the data
      await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS));

      const mockUsage: IPlaygroundUsageStats = {
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
      };

      const mockRateLimit: IRateLimitInfo = {
        minute: {
          remaining: Math.floor(Math.random() * MOCK_MINUTE_LIMIT),
          limit: MOCK_MINUTE_LIMIT,
          resetTime: new Date(Date.now() + MOCK_MINUTE_RESET_MS).toISOString(),
        },
        hour: {
          remaining: Math.floor(Math.random() * MOCK_HOUR_LIMIT),
          limit: MOCK_HOUR_LIMIT,
          resetTime: new Date(Date.now() + MOCK_HOUR_RESET_MS).toISOString(),
        },
        day: {
          remaining: Math.floor(Math.random() * MOCK_DAY_LIMIT),
          limit: MOCK_DAY_LIMIT,
          resetTime: new Date(Date.now() + MOCK_DAY_RESET_MS).toISOString(),
        },
      };

      setUsage(mockUsage);
      setRateLimit(mockRateLimit);
      setLastUpdate(new Date());
    } catch (error) {
      WebLogger.error('Failed to fetch usage stats', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getUsageColor = (current: number, max: number): string => {
    const percentage = (current / max) * PERCENTAGE_MULTIPLIER;
    if (percentage >= USAGE_WARNING_THRESHOLD) return 'text-red-500';
    if (percentage >= USAGE_CAUTION_THRESHOLD) return 'text-yellow-500';
    return 'text-green-500';
  };

  const getProgressColor = (current: number, max: number): string => {
    const percentage = (current / max) * PERCENTAGE_MULTIPLIER;
    if (percentage >= USAGE_WARNING_THRESHOLD) return 'bg-red-500';
    if (percentage >= USAGE_CAUTION_THRESHOLD) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  if (!isVisible || !usage || !rateLimit) {
    return null;
  }

  return (
    <Card className="fixed top-4 right-4 w-80 max-h-[80vh] overflow-auto z-50 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Usage Monitor
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={fetchUsageStats} disabled={isLoading}>
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
            {onClose && (
              <Button variant="ghost" size="sm" onClick={onClose}>
                ×
              </Button>
            )}
          </div>
        </div>
        {lastUpdate && (
          <div className="text-xs text-muted-foreground">
            Updated {lastUpdate.toLocaleTimeString()}
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Daily Usage */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              <span className="text-sm font-medium">Daily Executions</span>
            </div>
            <span
              className={`text-sm ${getUsageColor(usage.currentUsage.dailyExecutions, usage.dailyExecutions)}`}
            >
              {usage.currentUsage.dailyExecutions} / {usage.dailyExecutions}
            </span>
          </div>
          <Progress
            value={
              (usage.currentUsage.dailyExecutions / usage.dailyExecutions) * PERCENTAGE_MULTIPLIER
            }
            className="h-2"
          />
        </div>

        {/* Active Sessions */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              <span className="text-sm font-medium">Active Sessions</span>
            </div>
            <span
              className={`text-sm ${getUsageColor(usage.currentUsage.activeSessions, usage.maxConcurrentSessions)}`}
            >
              {usage.currentUsage.activeSessions} / {usage.maxConcurrentSessions}
            </span>
          </div>
          <Progress
            value={
              (usage.currentUsage.activeSessions / usage.maxConcurrentSessions) *
              PERCENTAGE_MULTIPLIER
            }
            className="h-2"
          />
        </div>

        {/* Token Usage */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4" />
              <span className="text-sm font-medium">Tokens Used</span>
            </div>
            <span
              className={`text-sm ${getUsageColor(usage.currentUsage.tokensUsed, usage.maxTokens)}`}
            >
              {usage.currentUsage.tokensUsed} / {usage.maxTokens}
            </span>
          </div>
          <Progress
            value={(usage.currentUsage.tokensUsed / usage.maxTokens) * PERCENTAGE_MULTIPLIER}
            className="h-2"
          />
        </div>

        {/* Rate Limits */}
        <div className="pt-3 border-t">
          <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Rate Limits
          </h4>

          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span>Per Minute</span>
              <span
                className={getUsageColor(
                  rateLimit.minute.limit - rateLimit.minute.remaining,
                  rateLimit.minute.limit,
                )}
              >
                {rateLimit.minute.remaining} remaining
              </span>
            </div>

            <div className="flex justify-between text-xs">
              <span>Per Hour</span>
              <span
                className={getUsageColor(
                  rateLimit.hour.limit - rateLimit.hour.remaining,
                  rateLimit.hour.limit,
                )}
              >
                {rateLimit.hour.remaining} remaining
              </span>
            </div>

            <div className="flex justify-between text-xs">
              <span>Per Day</span>
              <span
                className={getUsageColor(
                  rateLimit.day.limit - rateLimit.day.remaining,
                  rateLimit.day.limit,
                )}
              >
                {rateLimit.day.remaining} remaining
              </span>
            </div>
          </div>
        </div>

        {/* Features */}
        <div className="pt-3 border-t">
          <h4 className="text-sm font-medium mb-3">Available Features</h4>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-2">
              {usage.features.streaming ? (
                <CheckCircle className="w-4 h-4 text-green-500" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-gray-400" />
              )}
              <span className="text-xs">Streaming</span>
            </div>

            <div className="flex items-center gap-2">
              {usage.features.tools ? (
                <CheckCircle className="w-4 h-4 text-green-500" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-gray-400" />
              )}
              <span className="text-xs">Tools</span>
            </div>

            <div className="flex items-center gap-2 col-span-2">
              {usage.features.customTemplates ? (
                <CheckCircle className="w-4 h-4 text-green-500" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-gray-400" />
              )}
              <span className="text-xs">Custom Templates</span>
            </div>
          </div>
        </div>

        {/* Monetization UI intentionally removed */}
      </CardContent>
    </Card>
  );
}

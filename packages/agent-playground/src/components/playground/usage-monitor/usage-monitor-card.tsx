import { TrendingUp, Users, Zap } from 'lucide-react';

import { Card, CardContent } from '../../ui/card';
import type { IPlaygroundUsageStats, IRateLimitInfo } from './types';
import { FeaturesSection } from './features-section';
import { RateLimitsSection } from './rate-limits-section';
import { UsageMetric } from './usage-metric';
import { UsageMonitorHeader } from './usage-monitor-header';

export interface IUsageMonitorCardProps {
  usage: IPlaygroundUsageStats;
  rateLimit: IRateLimitInfo;
  isLoading: boolean;
  lastUpdate: Date | null;
  onClose?: () => void;
  onRefresh: () => void;
}

export function UsageMonitorCard({
  usage,
  rateLimit,
  isLoading,
  lastUpdate,
  onClose,
  onRefresh,
}: IUsageMonitorCardProps) {
  return (
    <Card className="fixed top-4 right-4 w-80 max-h-[80vh] overflow-auto z-50 shadow-lg">
      <UsageMonitorHeader
        isLoading={isLoading}
        lastUpdate={lastUpdate}
        onClose={onClose}
        onRefresh={onRefresh}
      />

      <CardContent className="space-y-4">
        <UsageMetric
          icon={<TrendingUp className="w-4 h-4" />}
          label="Daily Executions"
          current={usage.currentUsage.dailyExecutions}
          max={usage.dailyExecutions}
        />
        <UsageMetric
          icon={<Users className="w-4 h-4" />}
          label="Active Sessions"
          current={usage.currentUsage.activeSessions}
          max={usage.maxConcurrentSessions}
        />
        <UsageMetric
          icon={<Zap className="w-4 h-4" />}
          label="Tokens Used"
          current={usage.currentUsage.tokensUsed}
          max={usage.maxTokens}
        />
        <RateLimitsSection rateLimit={rateLimit} />
        <FeaturesSection features={usage.features} />
      </CardContent>
    </Card>
  );
}

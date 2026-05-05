'use client';

import type { IUsageMonitorProps } from './types';
import { UsageMonitorCard } from './usage-monitor-card';
import { useUsageMonitorState } from './use-usage-monitor-state';

export function UsageMonitor({ isVisible, onClose }: IUsageMonitorProps) {
  const { usage, rateLimit, isLoading, lastUpdate, fetchUsageStats } =
    useUsageMonitorState(isVisible);

  if (!isVisible || !usage || !rateLimit) {
    return null;
  }

  return (
    <UsageMonitorCard
      usage={usage}
      rateLimit={rateLimit}
      isLoading={isLoading}
      lastUpdate={lastUpdate}
      onClose={onClose}
      onRefresh={() => {
        void fetchUsageStats();
      }}
    />
  );
}

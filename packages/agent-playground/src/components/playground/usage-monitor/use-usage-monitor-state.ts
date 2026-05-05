import { useCallback, useEffect, useState } from 'react';

import { WebLogger } from '../../../lib/web-logger';
import { FETCH_DELAY_MS, REFRESH_INTERVAL_MS } from './constants';
import { createMockUsageSnapshot } from './mock-usage-snapshot';
import type { IPlaygroundUsageStats, IRateLimitInfo } from './types';

export interface IUsageMonitorState {
  usage: IPlaygroundUsageStats | null;
  rateLimit: IRateLimitInfo | null;
  isLoading: boolean;
  lastUpdate: Date | null;
  fetchUsageStats: () => Promise<void>;
}

export function useUsageMonitorState(isVisible: boolean): IUsageMonitorState {
  const [usage, setUsage] = useState<IPlaygroundUsageStats | null>(null);
  const [rateLimit, setRateLimit] = useState<IRateLimitInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchUsageStats = useCallback(async () => {
    setIsLoading(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS));

      const snapshot = createMockUsageSnapshot();
      setUsage(snapshot.usage);
      setRateLimit(snapshot.rateLimit);
      setLastUpdate(new Date());
    } catch (error) {
      WebLogger.error('Failed to fetch usage stats', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    void fetchUsageStats();
    const interval = setInterval(() => {
      void fetchUsageStats();
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [fetchUsageStats, isVisible]);

  return {
    usage,
    rateLimit,
    isLoading,
    lastUpdate,
    fetchUsageStats,
  };
}

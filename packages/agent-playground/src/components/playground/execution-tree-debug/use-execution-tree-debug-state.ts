import React, { useMemo } from 'react';
import type { IPlaygroundBlockCollector } from '../../../lib/playground/block-tracking';
import {
  clearExecutionTreeDebugBlocks,
  generateComplexExecutionTreeDemo,
  generateExecutionTreeDemo,
  refreshExecutionTreeDebug,
} from './execution-tree-debug-actions';
import { buildExecutionTreeDebugData } from './execution-tree-debug-data';

interface IUseExecutionTreeDebugStateOptions {
  blockCollector: IPlaygroundBlockCollector;
  refreshInterval: number;
}

export function useExecutionTreeDebugState({
  blockCollector,
  refreshInterval,
}: IUseExecutionTreeDebugStateOptions) {
  const [lastRefresh, setLastRefresh] = React.useState(Date.now());
  const [isClient, setIsClient] = React.useState(false);

  const { debugTree, rawBlocks, stats } = useMemo(
    () => buildExecutionTreeDebugData(blockCollector, isClient),
    [blockCollector, lastRefresh],
  );

  React.useEffect(() => {
    setIsClient(true);

    if (refreshInterval > 0) {
      const interval = setInterval(() => {
        setLastRefresh(Date.now());
      }, refreshInterval);

      return () => clearInterval(interval);
    }
    return;
  }, [refreshInterval]);

  return {
    debugTree,
    rawBlocks,
    stats,
    lastRefresh,
    isClient,
    handleRefresh: () => refreshExecutionTreeDebug(setLastRefresh),
    handleClear: () => clearExecutionTreeDebugBlocks(blockCollector, setLastRefresh),
    handleGenerateDemo: () => generateExecutionTreeDemo(blockCollector, setLastRefresh),
    handleGenerateComplexDemo: () =>
      generateComplexExecutionTreeDemo(blockCollector, setLastRefresh),
  };
}

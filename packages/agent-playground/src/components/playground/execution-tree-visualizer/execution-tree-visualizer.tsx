'use client';

import { useCallback, useMemo } from 'react';

import { calculateExecutionStats } from './execution-stats';
import { ExecutionTreeContent } from './execution-tree-content';
import { ExecutionTreeHeader } from './execution-tree-header';
import { buildExecutionTree } from './tree-builder';
import type { IRealTimeBlockMessage } from '../../../lib/playground/block-tracking/types';
import type { IExecutionTreeVisualizerProps } from './types';

export function ExecutionTreeVisualizer({
  blockCollector,
  showDebug = false,
  showProgress = true,
  onBlockSelect,
  selectedBlockId,
  blockFilter,
}: IExecutionTreeVisualizerProps) {
  const executionTree = useMemo(() => {
    return buildExecutionTree(blockCollector.getBlocks(), blockFilter);
  }, [blockCollector, blockFilter]);

  const executionStats = useMemo(() => {
    return calculateExecutionStats(blockCollector.getBlocks());
  }, [blockCollector]);

  const handleBlockSelect = useCallback(
    (block: IRealTimeBlockMessage) => {
      onBlockSelect?.(block);
    },
    [onBlockSelect],
  );

  const handleToggleExpand = useCallback(
    (blockId: string, isExpanded: boolean) => {
      blockCollector.updateRealTimeBlock(blockId, { isExpanded });
    },
    [blockCollector],
  );

  const handleClearBlocks = useCallback(() => {
    blockCollector.clearBlocks();
  }, [blockCollector]);

  return (
    <div className="h-full flex flex-col space-y-4">
      <ExecutionTreeHeader stats={executionStats} onClearBlocks={handleClearBlocks} />
      <ExecutionTreeContent
        executionTree={executionTree}
        selectedBlockId={selectedBlockId}
        showDebug={showDebug}
        showProgress={showProgress}
        onToggleExpand={handleToggleExpand}
        onBlockSelect={handleBlockSelect}
      />
    </div>
  );
}

export default ExecutionTreeVisualizer;

'use client';

import React from 'react';
import { ExecutionTreeDebugHeader } from './execution-tree-debug-header';
import { RawBlocksDebugCard } from './raw-blocks-debug-card';
import { TreeDebugCard } from './tree-debug-card';
import type { IExecutionTreeDebugProps } from './types';
import { useExecutionTreeDebugState } from './use-execution-tree-debug-state';

/**
 * ExecutionTreeDebug - JSON tree structure visualizer.
 *
 * Shows the raw tree structure as JSON to verify the tree building logic.
 * This helps debug the hierarchical execution tracking before implementing complex UI.
 */
export const ExecutionTreeDebug: React.FC<IExecutionTreeDebugProps> = ({
  blockCollector,
  refreshInterval = 1000,
}) => {
  const state = useExecutionTreeDebugState({ blockCollector, refreshInterval });

  return (
    <div className="h-full flex flex-col space-y-4">
      <ExecutionTreeDebugHeader
        stats={state.stats}
        lastRefresh={state.lastRefresh}
        isClient={state.isClient}
        refreshInterval={refreshInterval}
        onGenerateDemo={state.handleGenerateDemo}
        onGenerateComplexDemo={state.handleGenerateComplexDemo}
        onRefresh={state.handleRefresh}
        onClear={state.handleClear}
      />

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TreeDebugCard debugTree={state.debugTree} />
        <RawBlocksDebugCard rawBlocks={state.rawBlocks} />
      </div>
    </div>
  );
};

export default ExecutionTreeDebug;

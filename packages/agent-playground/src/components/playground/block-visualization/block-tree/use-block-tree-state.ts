import { useCallback, useState } from 'react';
import type { IBlockDataCollector, IBlockMessage } from '../../../../lib/playground/block-tracking';
import { buildBlockTree } from './build-block-tree';
import { useBlockCollectorEvents } from './use-block-collector-events';
import { useBlockCollectorSnapshot } from './use-block-collector-snapshot';
import { useBlockExpansionActions } from './use-block-expansion-actions';
import type { TBlockStats } from './types';

interface IUseBlockTreeStateInput {
  blockCollector: IBlockDataCollector;
  showDebug: boolean;
  onBlockSelect?: (block: IBlockMessage) => void;
}

interface IUseBlockTreeStateResult {
  stats: TBlockStats;
  localShowDebug: boolean;
  expandedBlocks: Set<string>;
  treeNodes: ReturnType<typeof buildBlockTree>;
  setLocalShowDebug: (showDebug: boolean) => void;
  handleToggleExpand: (blockId: string, isExpanded: boolean) => void;
  handleBlockClick: (block: IBlockMessage) => void;
  handleClearBlocks: () => void;
  handleRefresh: () => void;
  handleExpandAll: () => void;
  handleCollapseAll: () => void;
}

export function useBlockTreeState({
  blockCollector,
  showDebug,
  onBlockSelect,
}: IUseBlockTreeStateInput): IUseBlockTreeStateResult {
  const { blocks, stats, updateBlocks } = useBlockCollectorSnapshot(blockCollector);
  const [localShowDebug, setLocalShowDebug] = useState(showDebug);
  const [expandedBlocks, setExpandedBlocks] = useState<Set<string>>(new Set());

  useBlockCollectorEvents({ blockCollector, updateBlocks, setExpandedBlocks });
  const { handleToggleExpand, handleExpandAll, handleCollapseAll } = useBlockExpansionActions({
    blocks,
    blockCollector,
    setExpandedBlocks,
  });

  const handleBlockClick = useCallback(
    (block: IBlockMessage) => {
      onBlockSelect?.(block);
    },
    [onBlockSelect],
  );

  const handleClearBlocks = useCallback(() => {
    if (blockCollector) {
      blockCollector.clearBlocks();
    }
    setExpandedBlocks(new Set());
  }, [blockCollector]);

  const handleRefresh = useCallback(() => {
    updateBlocks();
  }, [updateBlocks]);

  const treeNodes = buildBlockTree(blocks);

  return {
    stats,
    localShowDebug,
    expandedBlocks,
    treeNodes,
    setLocalShowDebug,
    handleToggleExpand,
    handleBlockClick,
    handleClearBlocks,
    handleRefresh,
    handleExpandAll,
    handleCollapseAll,
  };
}

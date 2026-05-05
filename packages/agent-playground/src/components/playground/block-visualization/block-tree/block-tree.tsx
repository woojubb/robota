import React from 'react';
import { BlockTreeContent } from './block-tree-content';
import { BlockTreeControls } from './block-tree-controls';
import { getTreeHeightClass } from './tree-height-class';
import type { IBlockTreeProps } from './types';
import { useBlockTreeState } from './use-block-tree-state';

/**
 * BlockTree Component
 * Renders hierarchical block structure with real-time updates.
 */
export const BlockTree: React.FC<IBlockTreeProps> = ({
  blockCollector,
  height = '400px',
  showDebug = false,
  autoScroll: _autoScroll = true,
  onBlockSelect,
  selectedBlockId,
  showControls = true,
}) => {
  const {
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
  } = useBlockTreeState({ blockCollector, showDebug, onBlockSelect });
  const treeHeightClassName = getTreeHeightClass(height);

  return (
    <div className="flex flex-col h-full">
      {showControls && (
        <BlockTreeControls
          stats={stats}
          localShowDebug={localShowDebug}
          onToggleDebug={() => setLocalShowDebug(!localShowDebug)}
          onRefresh={handleRefresh}
          onExpandAll={handleExpandAll}
          onCollapseAll={handleCollapseAll}
          onClearBlocks={handleClearBlocks}
        />
      )}

      <BlockTreeContent
        treeNodes={treeNodes}
        treeHeightClassName={treeHeightClassName}
        expandedBlocks={expandedBlocks}
        selectedBlockId={selectedBlockId}
        showDebug={localShowDebug}
        onToggleExpand={handleToggleExpand}
        onBlockClick={handleBlockClick}
      />
    </div>
  );
};

import React from 'react';
import { BlockNode } from '../block-node';
import { ScrollArea } from '../../../ui/scroll-area';
import type { IBlockTreeContentProps, IBlockTreeNodeViewProps } from './types';

const BlockTreeNodeView: React.FC<IBlockTreeNodeViewProps> = ({
  treeNode,
  level = 0,
  expandedBlocks,
  selectedBlockId,
  showDebug,
  onToggleExpand,
  onBlockClick,
}) => {
  const { block, children } = treeNode;
  const isExpanded = expandedBlocks.has(block.blockMetadata.id) ?? block.blockMetadata.isExpanded;

  return (
    <BlockNode
      key={block.blockMetadata.id}
      block={block}
      level={level}
      isSelected={selectedBlockId === block.blockMetadata.id}
      showDebug={showDebug}
      onToggleExpand={onToggleExpand}
      onClick={onBlockClick}
    >
      {isExpanded &&
        children.map((childNode) => (
          <BlockTreeNodeView
            key={childNode.block.blockMetadata.id}
            treeNode={childNode}
            level={level + 1}
            expandedBlocks={expandedBlocks}
            selectedBlockId={selectedBlockId}
            showDebug={showDebug}
            onToggleExpand={onToggleExpand}
            onBlockClick={onBlockClick}
          />
        ))}
    </BlockNode>
  );
};

export const BlockTreeContent: React.FC<IBlockTreeContentProps> = ({
  treeNodes,
  treeHeightClassName,
  expandedBlocks,
  selectedBlockId,
  showDebug,
  onToggleExpand,
  onBlockClick,
}) => {
  return (
    <ScrollArea className={`flex-1 ${treeHeightClassName}`}>
      <div className="p-2">
        {treeNodes.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-500">
            <div className="text-center">
              <div className="text-sm font-medium">No blocks yet</div>
              <div className="text-xs">Blocks will appear here as tools execute</div>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {treeNodes.map((treeNode) => (
              <BlockTreeNodeView
                key={treeNode.block.blockMetadata.id}
                treeNode={treeNode}
                expandedBlocks={expandedBlocks}
                selectedBlockId={selectedBlockId}
                showDebug={showDebug}
                onToggleExpand={onToggleExpand}
                onBlockClick={onBlockClick}
              />
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  );
};

import type {
  IBlockDataCollector,
  IBlockMessage,
  IBlockTreeNode,
} from '../../../../lib/playground/block-tracking';

export type TBlockStats = ReturnType<IBlockDataCollector['getStats']>;

/**
 * Props for BlockTree component.
 */
export interface IBlockTreeProps {
  /** Block collector to get data from */
  blockCollector: IBlockDataCollector;

  /** Height of the tree container */
  height?: string | number;

  /** Whether to show debug information */
  showDebug?: boolean;

  /** Whether to auto-scroll to new blocks */
  autoScroll?: boolean;

  /** Callback when a block is selected */
  onBlockSelect?: (block: IBlockMessage) => void;

  /** Currently selected block ID */
  selectedBlockId?: string;

  /** Whether to show tree controls */
  showControls?: boolean;
}

export interface IBlockTreeControlsProps {
  stats: TBlockStats;
  localShowDebug: boolean;
  onToggleDebug: () => void;
  onRefresh: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onClearBlocks: () => void;
}

export interface IBlockTreeStatsBadgesProps {
  stats: TBlockStats;
}

export interface IBlockTreeActionMenuProps {
  onRefresh: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onClearBlocks: () => void;
}

export interface IBlockTreeContentProps {
  treeNodes: IBlockTreeNode[];
  treeHeightClassName: string;
  expandedBlocks: Set<string>;
  selectedBlockId?: string;
  showDebug: boolean;
  onToggleExpand: (blockId: string, isExpanded: boolean) => void;
  onBlockClick: (block: IBlockMessage) => void;
}

export interface IBlockTreeNodeViewProps {
  treeNode: IBlockTreeNode;
  level?: number;
  expandedBlocks: Set<string>;
  selectedBlockId?: string;
  showDebug: boolean;
  onToggleExpand: (blockId: string, isExpanded: boolean) => void;
  onBlockClick: (block: IBlockMessage) => void;
}

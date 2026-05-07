import type {
  IBlockMessage,
  IRealTimeBlockMessage,
} from '../../../lib/playground/block-tracking/types';
import type { IExecutionTreeNode } from './types';

function isTreeRenderableBlock(block: IBlockMessage): block is IRealTimeBlockMessage {
  return 'startTime' in block.blockMetadata || 'executionHierarchy' in block.blockMetadata;
}

function sortNodesByTime(nodes: IExecutionTreeNode[]): void {
  nodes.sort((a, b) => {
    const aTime = a.block.blockMetadata.startTime?.getTime() ?? 0;
    const bTime = b.block.blockMetadata.startTime?.getTime() ?? 0;
    return aTime - bTime;
  });

  nodes.forEach((node) => {
    if (node.children.length > 0) {
      sortNodesByTime(node.children);
    }
  });
}

export function buildExecutionTree(
  allBlocks: IBlockMessage[],
  blockFilter?: (block: IRealTimeBlockMessage) => boolean,
): IExecutionTreeNode[] {
  const realTimeBlocks = allBlocks.filter(isTreeRenderableBlock);
  const filteredBlocks = blockFilter ? realTimeBlocks.filter(blockFilter) : realTimeBlocks;
  const rootNodes: IExecutionTreeNode[] = [];
  const nodeMap = new Map<string, IExecutionTreeNode>();

  filteredBlocks.forEach((block) => {
    nodeMap.set(block.blockMetadata.id, {
      block,
      children: [],
      level: block.blockMetadata.executionHierarchy?.level ?? 0,
    });
  });

  filteredBlocks.forEach((block) => {
    const node = nodeMap.get(block.blockMetadata.id);
    if (!node) return;

    const parentId = block.blockMetadata.parentId;
    const parentNode = parentId ? nodeMap.get(parentId) : undefined;
    if (parentNode) {
      parentNode.children.push(node);
      node.level = parentNode.level + 1;
      return;
    }

    rootNodes.push(node);
  });

  sortNodesByTime(rootNodes);
  return rootNodes;
}

import type { IBlockMessage, IBlockTreeNode } from '../../../../lib/playground/block-tracking';

export function buildBlockTree(blocks: IBlockMessage[]): IBlockTreeNode[] {
  const blockMap = new Map<string, IBlockMessage>();
  const rootBlocks: IBlockMessage[] = [];

  blocks.forEach((block) => {
    blockMap.set(block.blockMetadata.id, block);
  });

  blocks.forEach((block) => {
    if (!block.blockMetadata.parentId) {
      rootBlocks.push(block);
    }
  });

  const buildNode = (block: IBlockMessage): IBlockTreeNode => {
    const children = block.blockMetadata.children
      .map((childId) => blockMap.get(childId))
      .filter((child): child is IBlockMessage => child !== undefined)
      .map((child) => buildNode(child));

    return {
      block,
      children,
      parent: undefined,
    };
  };

  const treeNodes = rootBlocks.map(buildNode);

  const setParentReferences = (nodes: IBlockTreeNode[], parent?: IBlockTreeNode): void => {
    nodes.forEach((node) => {
      node.parent = parent;
      setParentReferences(node.children, node);
    });
  };
  setParentReferences(treeNodes);

  return treeNodes;
}

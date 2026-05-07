import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { IBlockDataCollector, IBlockMessage } from '../../../../lib/playground/block-tracking';

interface IUseBlockExpansionActionsInput {
  blocks: IBlockMessage[];
  blockCollector: IBlockDataCollector;
  setExpandedBlocks: Dispatch<SetStateAction<Set<string>>>;
}

interface IBlockExpansionActions {
  handleToggleExpand: (blockId: string, isExpanded: boolean) => void;
  handleExpandAll: () => void;
  handleCollapseAll: () => void;
}

export function useBlockExpansionActions({
  blocks,
  blockCollector,
  setExpandedBlocks,
}: IUseBlockExpansionActionsInput): IBlockExpansionActions {
  const handleToggleExpand = useCallback(
    (blockId: string, isExpanded: boolean) => {
      setExpandedBlocks((prev) => {
        const newSet = new Set(prev);
        if (isExpanded) {
          newSet.add(blockId);
        } else {
          newSet.delete(blockId);
        }
        return newSet;
      });

      if (blockCollector) {
        blockCollector.updateBlock(blockId, { isExpanded });
      }
    },
    [blockCollector, setExpandedBlocks],
  );

  const handleExpandAll = useCallback(() => {
    const allBlockIds = blocks.map((block) => block.blockMetadata.id);
    setExpandedBlocks(new Set(allBlockIds));

    if (blockCollector) {
      allBlockIds.forEach((blockId) => {
        blockCollector.updateBlock(blockId, { isExpanded: true });
      });
    }
  }, [blocks, blockCollector, setExpandedBlocks]);

  const handleCollapseAll = useCallback(() => {
    setExpandedBlocks(new Set());

    if (blockCollector) {
      blocks.forEach((block) => {
        blockCollector.updateBlock(block.blockMetadata.id, { isExpanded: false });
      });
    }
  }, [blocks, blockCollector, setExpandedBlocks]);

  return { handleToggleExpand, handleExpandAll, handleCollapseAll };
}

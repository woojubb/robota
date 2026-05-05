import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type {
  IBlockDataCollector,
  TBlockCollectionEvent,
} from '../../../../lib/playground/block-tracking';

interface IUseBlockCollectorEventsInput {
  blockCollector: IBlockDataCollector;
  updateBlocks: () => void;
  setExpandedBlocks: Dispatch<SetStateAction<Set<string>>>;
}

export function useBlockCollectorEvents({
  blockCollector,
  updateBlocks,
  setExpandedBlocks,
}: IUseBlockCollectorEventsInput): void {
  useEffect(() => {
    if (!blockCollector) return;

    const handleBlockEvent = (event: TBlockCollectionEvent): void => {
      if (event.type === 'block_added' && event.block.blockMetadata.parentId) {
        setExpandedBlocks((prev) => new Set([...prev, event.block.blockMetadata.parentId!]));
      }

      if (event.type === 'blocks_cleared') {
        setExpandedBlocks(new Set());
      }

      updateBlocks();
    };

    blockCollector.addListener(handleBlockEvent);
    updateBlocks();

    return () => {
      blockCollector.removeListener(handleBlockEvent);
    };
  }, [blockCollector, updateBlocks, setExpandedBlocks]);
}

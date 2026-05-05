import { useCallback, useState } from 'react';
import type { IBlockDataCollector, IBlockMessage } from '../../../../lib/playground/block-tracking';
import type { TBlockStats } from './types';

interface IBlockCollectorSnapshot {
  blocks: IBlockMessage[];
  stats: TBlockStats;
  updateBlocks: () => void;
}

const EMPTY_STATS: TBlockStats = {
  total: 0,
  byType: {},
  byState: {},
  rootBlocks: 0,
};

export function useBlockCollectorSnapshot(
  blockCollector: IBlockDataCollector,
): IBlockCollectorSnapshot {
  const [blocks, setBlocks] = useState<IBlockMessage[]>([]);
  const [stats, setStats] = useState(() =>
    blockCollector ? blockCollector.getStats() : EMPTY_STATS,
  );

  const updateBlocks = useCallback(() => {
    if (!blockCollector) return;

    const newBlocks = blockCollector.getBlocks();
    setBlocks(newBlocks);
    setStats(blockCollector.getStats());
  }, [blockCollector]);

  return { blocks, stats, updateBlocks };
}

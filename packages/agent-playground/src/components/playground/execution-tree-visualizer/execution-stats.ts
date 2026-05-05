import type {
  IBlockMessage,
  IRealTimeBlockMessage,
  IRealTimeBlockMetadata,
} from '../../../lib/playground/block-tracking/types';

export interface IExecutionTreeStats {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  error: number;
  totalDuration: number;
  avgDuration: number;
}

function hasStartTime(block: IBlockMessage): block is IRealTimeBlockMessage {
  return 'startTime' in block.blockMetadata;
}

export function calculateExecutionStats(allBlocks: IBlockMessage[]): IExecutionTreeStats {
  const realTimeBlocks = allBlocks.filter(hasStartTime);
  const stats: IExecutionTreeStats = {
    total: realTimeBlocks.length,
    pending: 0,
    inProgress: 0,
    completed: 0,
    error: 0,
    totalDuration: 0,
    avgDuration: 0,
  };
  const completedDurations: number[] = [];

  realTimeBlocks.forEach((block) => {
    const metadata = block.blockMetadata as IRealTimeBlockMetadata;
    switch (metadata.visualState) {
      case 'pending':
        stats.pending++;
        break;
      case 'in_progress':
        stats.inProgress++;
        break;
      case 'completed':
        stats.completed++;
        if (metadata.actualDuration) {
          completedDurations.push(metadata.actualDuration);
          stats.totalDuration += metadata.actualDuration;
        }
        break;
      case 'error':
        stats.error++;
        break;
    }
  });

  if (completedDurations.length > 0) {
    stats.avgDuration = stats.totalDuration / completedDurations.length;
  }

  return stats;
}

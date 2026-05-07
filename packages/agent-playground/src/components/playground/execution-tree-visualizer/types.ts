import type { IPlaygroundBlockCollector } from '../../../lib/playground/block-tracking/block-collector';
import type { IRealTimeBlockMessage } from '../../../lib/playground/block-tracking/types';

export interface IExecutionTreeNode {
  block: IRealTimeBlockMessage;
  children: IExecutionTreeNode[];
  level: number;
}

export interface IExecutionTreeVisualizerProps {
  blockCollector: IPlaygroundBlockCollector;
  showDebug?: boolean;
  showProgress?: boolean;
  autoExpand?: boolean;
  onBlockSelect?: (block: IRealTimeBlockMessage) => void;
  selectedBlockId?: string;
  blockFilter?: (block: IRealTimeBlockMessage) => boolean;
}

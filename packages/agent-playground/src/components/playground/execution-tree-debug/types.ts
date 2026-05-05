import type { IPlaygroundBlockCollector } from '../../../lib/playground/block-tracking';
import type { IRealTimeBlockMessage } from '../../../lib/playground/block-tracking/types';

/**
 * Tree node structure for debugging.
 */
export interface IDebugTreeNode {
  id: string;
  type: string;
  state: string;
  toolName?: string;
  level: number;
  parentId?: string;
  startTime?: string;
  endTime?: string;
  duration?: number;
  executionPath?: string[];
  children: IDebugTreeNode[];
}

export interface IExecutionTreeDebugStats {
  totalBlocks: number;
  rootNodes: number;
  pending: number;
  inProgress: number;
  completed: number;
  error: number;
}

export interface IExecutionTreeDebugData {
  debugTree: IDebugTreeNode[];
  rawBlocks: IRealTimeBlockMessage[];
  stats: IExecutionTreeDebugStats;
}

/**
 * Props for ExecutionTreeDebug component.
 */
export interface IExecutionTreeDebugProps {
  /** Block collector containing all execution blocks. */
  blockCollector: IPlaygroundBlockCollector;

  /** Auto-refresh interval in milliseconds. */
  refreshInterval?: number;
}

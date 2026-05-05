import type {
  IBlockMessage,
  IPlaygroundBlockCollector,
} from '../../../../lib/playground/block-tracking';

/**
 * Props for BlockVisualizationPanel.
 */
export interface IBlockVisualizationPanelProps {
  /** Block collector instance */
  blockCollector: IPlaygroundBlockCollector;

  /** Panel height */
  height?: string | number;

  /** Whether to show debug information */
  showDebug?: boolean;

  /** Whether to auto-scroll to new blocks */
  autoScroll?: boolean;

  /** Callback when a block is selected for inspection */
  onBlockInspect?: (block: IBlockMessage) => void;
}

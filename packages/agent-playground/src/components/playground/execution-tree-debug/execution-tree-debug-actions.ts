import type React from 'react';
import type { IPlaygroundBlockCollector } from '../../../lib/playground/block-tracking';
import {
  generateComplexDemoData,
  generateDemoExecutionData,
} from '../../../lib/playground/demo-execution-data';
import { WebLogger } from '../../../lib/web-logger';
import { createManualDemoBlock } from './manual-demo-block';

type TRefreshSetter = React.Dispatch<React.SetStateAction<number>>;

export function refreshExecutionTreeDebug(setLastRefresh: TRefreshSetter): void {
  setLastRefresh(Date.now());
}

export function clearExecutionTreeDebugBlocks(
  blockCollector: IPlaygroundBlockCollector,
  setLastRefresh: TRefreshSetter,
): void {
  WebLogger.debug('Clear button clicked');
  WebLogger.debug('Blocks before clear', { count: blockCollector.getBlocks().length });
  blockCollector.clearBlocks();
  WebLogger.debug('Blocks after clear', { count: blockCollector.getBlocks().length });
  refreshExecutionTreeDebug(setLastRefresh);
  WebLogger.info('Clear completed');
}

export function generateExecutionTreeDemo(
  blockCollector: IPlaygroundBlockCollector,
  setLastRefresh: TRefreshSetter,
): void {
  WebLogger.debug('Generate Demo button clicked');
  WebLogger.debug('Current block count before', { count: blockCollector.getBlocks().length });

  try {
    const testBlock = createManualDemoBlock();

    WebLogger.debug('Adding test block', {
      blockId: testBlock.blockMetadata.id,
      blockType: testBlock.blockMetadata.type,
    });
    blockCollector.collectBlock(testBlock);
    WebLogger.debug('Block count after test block', {
      count: blockCollector.getBlocks().length,
    });

    generateDemoExecutionData(blockCollector);
    WebLogger.debug('Current block count after demo', {
      count: blockCollector.getBlocks().length,
    });
    refreshExecutionTreeDebug(setLastRefresh);
    WebLogger.info('Demo data generated successfully');
  } catch (error) {
    WebLogger.error('Error generating demo data', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function generateComplexExecutionTreeDemo(
  blockCollector: IPlaygroundBlockCollector,
  setLastRefresh: TRefreshSetter,
): void {
  WebLogger.debug('Generate Complex Demo button clicked');
  try {
    generateComplexDemoData(blockCollector);
    refreshExecutionTreeDebug(setLastRefresh);
    WebLogger.info('Complex demo data generated successfully');
  } catch (error) {
    WebLogger.error('Error generating complex demo data', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

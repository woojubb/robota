import type { IPlaygroundBlockCollector } from '../block-tracking/block-collector';
import { WebLogger } from '../../web-logger';
import { createDemoExecutionBlocks } from './scenario';

export function generateDemoExecutionData(blockCollector: IPlaygroundBlockCollector): void {
  WebLogger.debug('Generating demo execution data');

  blockCollector.clearBlocks();

  createDemoExecutionBlocks(new Date()).forEach((block) => {
    blockCollector.collectBlock(block);
  });

  WebLogger.debug('Demo execution data generated successfully', { blockCount: 6 });
}

export function generateComplexDemoData(blockCollector: IPlaygroundBlockCollector): void {
  WebLogger.debug('Generating complex demo execution data');

  blockCollector.clearBlocks();
  generateDemoExecutionData(blockCollector);

  WebLogger.debug('Complex demo data generation complete');
}

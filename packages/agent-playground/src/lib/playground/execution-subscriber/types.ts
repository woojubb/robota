import type { IPlaygroundBlockCollector } from '../block-tracking/block-collector';
import type { IExecutionHierarchyInfo } from '../block-tracking/types';

export interface IActiveExecution {
  blockId: string;
  startTime: Date;
  hierarchyInfo?: IExecutionHierarchyInfo;
}

export interface IExecutionSubscriberContext {
  blockCollector: IPlaygroundBlockCollector;
  activeExecutions: Map<string, IActiveExecution>;
  generateBlockId(): string;
  getParentBlockId(parentExecutionId?: string): string | undefined;
}

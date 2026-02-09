import type { TEventLogRecord } from './event-log.js';
import type { TWorkflowUpdate } from './workflow-builder.js';

export interface IWorkflowProjection {
    apply(record: TEventLogRecord): Promise<TWorkflowUpdate[]>;
    applyFromHistory(fromSequenceId: number, toSequenceId?: number): Promise<TWorkflowUpdate[]>;
}

export interface IHistoryProjection {
    apply(record: TEventLogRecord): Promise<void>;
}

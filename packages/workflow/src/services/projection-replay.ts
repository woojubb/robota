import type { IEventLogStore } from '../interfaces/event-log-store.js';
import type { IHistoryProjection, IWorkflowProjection } from '../interfaces/event-projection.js';
import type { TWorkflowUpdate } from '../interfaces/workflow-builder.js';

export interface IProjectionReplayOptions {
    startSequenceId: number;
    endSequenceId?: number;
}

export interface IProjectionReplayResult {
    totalEvents: number;
    workflowUpdates: TWorkflowUpdate[];
    historyApplied: number;
}

export class ProjectionReplayService {
    constructor(
        private readonly store: IEventLogStore,
        private readonly workflowProjection?: IWorkflowProjection,
        private readonly historyProjection?: IHistoryProjection
    ) {}

    async replay(options: IProjectionReplayOptions): Promise<IProjectionReplayResult> {
        if (!this.workflowProjection && !this.historyProjection) {
            throw new Error('[PROJECTION-REPLAY] At least one projection is required.');
        }
        if (options.startSequenceId < 1) {
            throw new Error('[PROJECTION-REPLAY] startSequenceId must be >= 1.');
        }
        const records = this.store.read(options.startSequenceId, options.endSequenceId);
        const workflowUpdates: TWorkflowUpdate[] = [];
        let historyApplied = 0;
        for (const record of records) {
            if (this.workflowProjection) {
                const updates = await this.workflowProjection.apply(record);
                workflowUpdates.push(...updates);
            }
            if (this.historyProjection) {
                await this.historyProjection.apply(record);
                historyApplied += 1;
            }
        }
        return {
            totalEvents: records.length,
            workflowUpdates,
            historyApplied
        };
    }
}

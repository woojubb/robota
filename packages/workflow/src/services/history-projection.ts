import type { TEventLogRecord } from '../interfaces/event-log.js';
import type { IHistoryProjection } from '../interfaces/event-projection.js';

export interface IHistoryTimelineEntry {
    eventName: string;
    timestamp: Date;
    ownerPath: string[];
    payload: TEventLogRecord['payload'];
}

export class HistoryProjection implements IHistoryProjection {
    private timeline: IHistoryTimelineEntry[] = [];

    async apply(record: TEventLogRecord): Promise<void> {
        if (!record.ownerPath || record.ownerPath.length === 0) {
            throw new Error('[HISTORY-PROJECTION] ownerPath is required');
        }
        this.timeline.push({
            eventName: record.eventName,
            timestamp: record.timestamp,
            ownerPath: record.ownerPath.map(seg => seg.id),
            payload: record.payload
        });
    }

    getTimeline(): IHistoryTimelineEntry[] {
        return [...this.timeline];
    }
}

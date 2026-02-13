import type { TEventLogRecord } from '../interfaces/event-log.js';
import type { TEventData } from '../interfaces/event-handler.js';
import type { IHistoryProjection } from '../interfaces/event-projection.js';
import { toEventDataFromHistory } from './event-record-adapter.js';

export interface IHistoryTimelineEntry {
    eventName: string;
    timestamp: Date;
    ownerPath: string[];
    payload: TEventData;
}

export class HistoryProjection implements IHistoryProjection {
    private timeline: IHistoryTimelineEntry[] = [];

    async apply(record: TEventLogRecord): Promise<void> {
        if (!record.context?.ownerPath || record.context.ownerPath.length === 0) {
            throw new Error('[HISTORY-PROJECTION] ownerPath is required');
        }
        this.timeline.push({
            eventName: record.eventName,
            timestamp: record.timestamp,
            ownerPath: record.context.ownerPath.map(seg => seg.id),
            payload: toEventDataFromHistory(record)
        });
    }

    getTimeline(): IHistoryTimelineEntry[] {
        return [...this.timeline];
    }
}

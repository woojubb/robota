import type { IEventHistoryRecord } from '@robota-sdk/agents';
import type { TEventData } from '../interfaces/event-handler.js';

export function toEventDataFromHistory(record: IEventHistoryRecord): TEventData {
    const ownerPath = record.context?.ownerPath;
    if (!ownerPath || ownerPath.length === 0) {
        throw new Error(`[WORKFLOW-PROJECTION] Missing ownerPath for ${record.eventName}`);
    }
    return {
        ...record.eventData,
        eventType: record.eventName,
        timestamp: record.eventData.timestamp,
        context: record.context
    };
}

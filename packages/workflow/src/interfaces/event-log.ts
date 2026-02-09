import type { IOwnerPathSegment } from '@robota-sdk/agents';
import type { TEventData } from './event-handler.js';

export interface TEventLogRecord {
    eventName: string;
    timestamp: Date;
    ownerPath: IOwnerPathSegment[];
    payload: TEventData;
}

export const EVENT_LOG_RULES = {
    // Missing ownerPath is a developer error and must throw.
    REQUIRED_OWNER_PATH: 'ownerPath is required for event log records.'
} as const;

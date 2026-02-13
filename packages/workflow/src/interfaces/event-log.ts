import type { IOwnerPathSegment } from '@robota-sdk/agents';
import type { TEventData } from './event-handler.js';

export interface TEventLogRecord {
    eventName: string;
    timestamp: Date;
    ownerPath: IOwnerPathSegment[];
    payload: TEventData;
}

export const EVENT_LOG_RULES = {
    // Event log records the received event as-is without completion assumptions.
    MINIMAL_RECORDING: 'Record each received event unit as-is. Do not synthesize completion state.',
    // Missing ownerPath is a developer error and must throw.
    REQUIRED_OWNER_PATH: 'ownerPath is required for event log records.'
} as const;

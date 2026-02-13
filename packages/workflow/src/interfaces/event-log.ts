import type { IEventHistoryRecord } from '@robota-sdk/agents';

export type TEventLogRecord = IEventHistoryRecord;

export const EVENT_LOG_RULES = {
    // Event log records the received event as-is without completion assumptions.
    MINIMAL_RECORDING: 'Record each received event unit as-is. Do not synthesize completion state.',
    // Missing context.ownerPath is a developer error and must throw.
    REQUIRED_OWNER_PATH: 'context.ownerPath is required for event log records.'
} as const;

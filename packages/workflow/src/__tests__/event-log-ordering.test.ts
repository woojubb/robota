import { describe, expect, it } from 'vitest';
import {
    composeEventName,
    EXECUTION_EVENTS,
    EXECUTION_EVENT_PREFIX,
    type IOwnerPathSegment
} from '@robota-sdk/agents';
import { compareEventOrdering, type IEventOrderingRecord } from '../services/event-log-ordering.js';

const record = (
    ownerPath: IOwnerPathSegment[],
    timestamp: Date,
    eventName: string,
    sequenceId?: number
): IEventOrderingRecord => ({
    ownerPath,
    timestamp,
    eventName,
    sequenceId
});

describe('compareEventOrdering', () => {
    const executionStartEvent = composeEventName(EXECUTION_EVENT_PREFIX, EXECUTION_EVENTS.START);
    const executionErrorEvent = composeEventName(EXECUTION_EVENT_PREFIX, EXECUTION_EVENTS.ERROR);
    const executionCompleteEvent = composeEventName(EXECUTION_EVENT_PREFIX, EXECUTION_EVENTS.COMPLETE);

    it('orders by ownerPath first', () => {
        const left = record([{ type: 'agent', id: 'a' }], new Date(10), executionStartEvent, 2);
        const right = record([{ type: 'agent', id: 'b' }], new Date(1), executionErrorEvent, 1);
        expect(compareEventOrdering(left, right)).toBeLessThan(0);
    });

    it('orders by timestamp when ownerPath is equal', () => {
        const path = [{ type: 'agent', id: 'a' }];
        const left = record(path, new Date(1), executionStartEvent, 3);
        const right = record(path, new Date(2), executionStartEvent, 1);
        expect(compareEventOrdering(left, right)).toBeLessThan(0);
    });

    it('orders by eventName then sequenceId on ties', () => {
        const path = [{ type: 'agent', id: 'a' }];
        const sameTimestamp = new Date(5);
        const left = record(path, sameTimestamp, executionCompleteEvent, 2);
        const right = record(path, sameTimestamp, executionCompleteEvent, 3);
        expect(compareEventOrdering(left, right)).toBeLessThan(0);
    });
});

import { describe, expect, it } from 'vitest';
import type { IOwnerPathSegment } from '@robota-sdk/agents';
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
    it('orders by ownerPath first', () => {
        const left = record([{ type: 'agent', id: 'a' }], new Date(10), 'execution.start', 2);
        const right = record([{ type: 'agent', id: 'b' }], new Date(1), 'execution.error', 1);
        expect(compareEventOrdering(left, right)).toBeLessThan(0);
    });

    it('orders by timestamp when ownerPath is equal', () => {
        const path = [{ type: 'agent', id: 'a' }];
        const left = record(path, new Date(1), 'execution.start', 3);
        const right = record(path, new Date(2), 'execution.start', 1);
        expect(compareEventOrdering(left, right)).toBeLessThan(0);
    });

    it('orders by eventName then sequenceId on ties', () => {
        const path = [{ type: 'agent', id: 'a' }];
        const sameTimestamp = new Date(5);
        const left = record(path, sameTimestamp, 'execution.complete', 2);
        const right = record(path, sameTimestamp, 'execution.complete', 3);
        expect(compareEventOrdering(left, right)).toBeLessThan(0);
    });
});

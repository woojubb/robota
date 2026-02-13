import type { IEventLogSnapshot, IEventLogStore, TEventLogAppendInput } from '../interfaces/event-log-store.js';
import type { TEventLogRecord } from '../interfaces/event-log.js';
import { compareEventOrdering } from './event-log-ordering.js';

export class InMemoryLogStore implements IEventLogStore {
    private records: TEventLogRecord[] = [];
    private snapshot: IEventLogSnapshot | undefined;
    private lastSequenceId = 0;

    append(record: TEventLogAppendInput): number {
        if (!record.context?.ownerPath || record.context.ownerPath.length === 0) {
            throw new Error('[EVENT-LOG] context.ownerPath is required');
        }
        const sequenceId = this.lastSequenceId + 1;
        this.records.push({ ...record, sequenceId });
        this.lastSequenceId = sequenceId;
        return sequenceId;
    }

    read(fromSequenceId: number, toSequenceId?: number): TEventLogRecord[] {
        const upper = typeof toSequenceId === 'number' ? toSequenceId : Number.POSITIVE_INFINITY;
        return this.records
            .filter(record => record.sequenceId >= fromSequenceId && record.sequenceId <= upper)
            .sort((left, right) => compareEventOrdering({
                ownerPath: left.context.ownerPath,
                timestamp: left.timestamp,
                eventName: left.eventName,
                sequenceId: left.sequenceId
            }, {
                ownerPath: right.context.ownerPath,
                timestamp: right.timestamp,
                eventName: right.eventName,
                sequenceId: right.sequenceId
            }));
    }

    getSnapshot(): IEventLogSnapshot | undefined {
        return this.snapshot;
    }

    saveSnapshot(snapshot: IEventLogSnapshot): void {
        this.snapshot = snapshot;
    }
}

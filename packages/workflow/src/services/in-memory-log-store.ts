import type { IEventLogSnapshot, IEventLogStore } from '../interfaces/event-log-store.js';
import type { TEventLogRecord } from '../interfaces/event-log.js';
import { compareEventOrdering } from './event-log-ordering.js';

export interface IEventLogStoredRecord extends TEventLogRecord {
    sequenceId: number;
}

export class InMemoryLogStore implements IEventLogStore {
    private records: IEventLogStoredRecord[] = [];
    private snapshot: IEventLogSnapshot | undefined;
    private lastSequenceId = 0;

    append(record: TEventLogRecord): number {
        if (!record.ownerPath || record.ownerPath.length === 0) {
            throw new Error('[EVENT-LOG] ownerPath is required');
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
            .sort((left, right) => compareEventOrdering(left, right));
    }

    getSnapshot(): IEventLogSnapshot | undefined {
        return this.snapshot;
    }

    saveSnapshot(snapshot: IEventLogSnapshot): void {
        this.snapshot = snapshot;
    }
}

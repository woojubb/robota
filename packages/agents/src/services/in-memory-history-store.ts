import type { IEventHistoryModule, IEventHistoryRecord, IEventHistorySnapshot } from '../interfaces/history-module';

export class InMemoryHistoryStore implements IEventHistoryModule {
    private records: IEventHistoryRecord[] = [];
    private snapshot: IEventHistorySnapshot | undefined;
    private lastSequenceId = 0;

    append(record: IEventHistoryRecord): void {
        if (!record.context?.ownerPath?.length) {
            throw new Error('[HISTORY-STORE] ownerPath is required');
        }
        if (record.sequenceId <= this.lastSequenceId) {
            throw new Error(`[HISTORY-STORE] sequenceId must increase. last=${this.lastSequenceId} next=${record.sequenceId}`);
        }
        this.records.push(record);
        this.lastSequenceId = record.sequenceId;
    }

    read(fromSequenceId: number, toSequenceId?: number): IEventHistoryRecord[] {
        const upper = typeof toSequenceId === 'number' ? toSequenceId : Number.POSITIVE_INFINITY;
        return this.records.filter(record => record.sequenceId >= fromSequenceId && record.sequenceId <= upper);
    }

    async *readStream(fromSequenceId: number, toSequenceId?: number): AsyncIterable<IEventHistoryRecord> {
        if (fromSequenceId < 1) {
            throw new Error('[HISTORY-STORE] fromSequenceId must be >= 1');
        }
        const upper = typeof toSequenceId === 'number' ? toSequenceId : Number.POSITIVE_INFINITY;
        for (const record of this.records) {
            if (record.sequenceId < fromSequenceId) {
                continue;
            }
            if (record.sequenceId > upper) {
                break;
            }
            yield record;
        }
    }

    getSnapshot(): IEventHistorySnapshot | undefined {
        return this.snapshot;
    }

    saveSnapshot(snapshot: IEventHistorySnapshot): void {
        this.snapshot = snapshot;
    }
}

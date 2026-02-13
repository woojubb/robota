import type { TEventLogRecord } from './event-log.js';

export type TEventLogAppendInput = Omit<TEventLogRecord, 'sequenceId'>;

export interface IEventLogSnapshot {
    lastSequenceId: number;
    createdAt: Date;
}

export interface IEventLogStore {
    append(record: TEventLogAppendInput): number;
    read(fromSequenceId: number, toSequenceId?: number): TEventLogRecord[];
    getSnapshot(): IEventLogSnapshot | undefined;
    saveSnapshot(snapshot: IEventLogSnapshot): void;
}

import type { TEventLogRecord } from './event-log.js';

export interface IEventLogSnapshot {
    lastSequenceId: number;
    createdAt: Date;
}

export interface IEventLogStore {
    append(record: TEventLogRecord): number;
    read(fromSequenceId: number, toSequenceId?: number): TEventLogRecord[];
    getSnapshot(): IEventLogSnapshot | undefined;
    saveSnapshot(snapshot: IEventLogSnapshot): void;
}

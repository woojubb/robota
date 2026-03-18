import type { IBaseEventData, IEventContext } from './event-service';

export interface IEventHistoryRecord {
  eventName: string;
  sequenceId: number;
  timestamp: Date;
  eventData: IBaseEventData;
  context: IEventContext;
}

export interface IEventHistorySnapshot {
  lastSequenceId: number;
  createdAt: Date;
}

export interface IEventHistoryModule {
  append(record: IEventHistoryRecord): void;
  read(fromSequenceId: number, toSequenceId?: number): IEventHistoryRecord[];
  readStream(fromSequenceId: number, toSequenceId?: number): AsyncIterable<IEventHistoryRecord>;
  getSnapshot?(): IEventHistorySnapshot | undefined;
}

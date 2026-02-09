import type { IBaseEventData, IEventContext, IEventService, TEventListener } from '../interfaces/event-service';
import type { IEventHistoryModule, IEventHistoryRecord, IEventHistorySnapshot } from '../interfaces/history-module';

export class EventHistoryModule implements IEventHistoryModule {
    private readonly store: IEventHistoryModule;
    private readonly listener: TEventListener;
    private sequenceId = 0;

    constructor(store: IEventHistoryModule, eventService: IEventService) {
        this.store = store;
        this.listener = (eventName: string, eventData: IBaseEventData, context?: IEventContext) => {
            if (!context?.ownerPath?.length) {
                throw new Error(`[HISTORY-MODULE] Missing ownerPath for ${eventName}`);
            }
            const record: IEventHistoryRecord = {
                eventName,
                sequenceId: this.nextSequenceId(),
                timestamp: eventData.timestamp,
                eventData,
                context
            };
            this.store.append(record);
        };
        eventService.subscribe(this.listener);
    }

    append(record: IEventHistoryRecord): void {
        this.store.append(record);
    }

    read(fromSequenceId: number, toSequenceId?: number): IEventHistoryRecord[] {
        return this.store.read(fromSequenceId, toSequenceId);
    }

    readStream(fromSequenceId: number, toSequenceId?: number): AsyncIterable<IEventHistoryRecord> {
        return this.store.readStream(fromSequenceId, toSequenceId);
    }

    getSnapshot(): IEventHistorySnapshot | undefined {
        return this.store.getSnapshot?.();
    }

    detach(eventService: IEventService): void {
        eventService.unsubscribe(this.listener);
    }

    private nextSequenceId(): number {
        this.sequenceId += 1;
        return this.sequenceId;
    }
}

import type { IBaseEventData, IEventContext, IEventService, SimpleLogger } from '@robota-sdk/agents';
import { SilentLogger } from '@robota-sdk/agents';
import type { TEventData, WorkflowEventSubscriber } from '@robota-sdk/workflow';

/**
 * WorkflowSubscriberEventService
 *
 * Bridges `EventService.emit(...)` to `WorkflowEventSubscriber.processEvent(...)`.
 *
 * Design notes:
 * - Serializes processing to preserve emission order (no timers, no retries).
 * - Forwards the provided EventContext by attaching it to the event payload.
 * - Does not interpret or hardcode event names (domain-neutral).
 */
export class WorkflowSubscriberEventService implements IEventService {
    private tail: Promise<void> = Promise.resolve();

    constructor(
        private readonly subscriber: WorkflowEventSubscriber,
        private readonly logger: SimpleLogger = SilentLogger
    ) { }

    emit(eventType: string, data: IBaseEventData, context?: IEventContext): void {
        if (!data.timestamp) {
            throw new Error(`[PATH-ONLY] Missing timestamp for eventType=${String(eventType)}`);
        }
        if (!context?.ownerPath?.length) {
            throw new Error(`[PATH-ONLY] Missing context.ownerPath for eventType=${String(eventType)}`);
        }

        const { context: _legacyContext, ownerPath: _legacyOwnerPath, ...rest } = data;
        const payload: TEventData = {
            ...rest,
            eventType: String(eventType),
            timestamp: data.timestamp,
            context,
        };

        this.tail = this.tail
            .then(async () => {
                await this.subscriber.processEvent(String(eventType), payload);
            })
            .catch((error) => {
                // Strict policy: surface the error via logger (no fallback path).
                this.logger.error('WorkflowSubscriberEventService failed to process event', {
                    eventType: String(eventType),
                    error: error instanceof Error ? error.message : String(error)
                });
                throw error instanceof Error ? error : new Error(String(error));
            });
    }
}



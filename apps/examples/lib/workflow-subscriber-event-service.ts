import type { IBaseEventData, IEventContext, IEventService, SimpleLogger } from '@robota-sdk/agents';
import { SilentLogger } from '@robota-sdk/agents';
import type { WorkflowEventSubscriber } from '@robota-sdk/workflow';

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
        if (!context) {
            throw new Error('[PATH-ONLY] Missing EventContext for workflow bridge (context is required).');
        }
        if (context?.ownerPath?.length) {
            for (const seg of context.ownerPath) {
                const id = seg?.id;
                if (typeof id !== 'string' || id.length === 0) {
                    throw new Error('[PATH-ONLY] Invalid context.ownerPath (missing segment id) for workflow bridge');
                }
            }
        }
        const payload = {
            eventType,
            ...data,
            context
        };

        this.tail = this.tail
            .then(async () => {
                await this.subscriber.processEvent(String(eventType), payload);
            })
            .catch((error: unknown) => {
                // Strict policy: surface the error via logger (no fallback path).
                this.logger.error('WorkflowSubscriberEventService failed to process event', {
                    eventType: String(eventType),
                    error: error instanceof Error ? error.message : String(error)
                });
                throw error instanceof Error ? error : new Error(String(error));
            });
    }

    /**
     * Await all queued event processing.
     * Required for deterministic examples that export a snapshot after execution.
     */
    async flush(): Promise<void> {
        await this.tail;
    }
}



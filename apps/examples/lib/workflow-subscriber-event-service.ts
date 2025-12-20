import type { EventContext, EventService, ServiceEventData, ServiceEventType, SimpleLogger } from '@robota-sdk/agents';
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
export class WorkflowSubscriberEventService implements EventService {
    private tail: Promise<void> = Promise.resolve();

    constructor(
        private readonly subscriber: WorkflowEventSubscriber,
        private readonly logger: SimpleLogger = SilentLogger
    ) { }

    emit(eventType: ServiceEventType, data: ServiceEventData, context?: EventContext): void {
        const derivedPath = (() => {
            if (!context?.ownerPath?.length) {
                return undefined;
            }
            const ids: string[] = [];
            for (const seg of context.ownerPath) {
                const id = seg?.id;
                if (typeof id !== 'string' || id.length === 0) {
                    throw new Error('[PATH-ONLY] Invalid context.ownerPath (missing segment id) for workflow bridge');
                }
                ids.push(id);
            }
            return ids;
        })();

        const payload = {
            eventType,
            ...data,
            ...(derivedPath ? { path: derivedPath } : {}),
            ...(context ? { context } : {})
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



import type { IBaseEventData, IEventContext, IEventService, ILogger, TEventListener } from '@robota-sdk/agents';
import { SilentLogger } from '@robota-sdk/agents';

import type { TEventData } from '../interfaces/event-handler.js';
import type { IWorkflowEventSubscriber } from './workflow-event-subscriber.js';

/**
 * WorkflowSubscriberEventService
 *
 * Bridges `IEventService.emit(...)` to `WorkflowEventSubscriber.processEvent(...)`.
 *
 * Design notes:
 * - Serializes processing to preserve emission order (no timers, no retries).
 * - Requires explicit linkage information (Path-only): context.ownerPath must be present and non-empty.
 * - Requires timestamp for deterministic ordering.
 * - Does not interpret or hardcode event names (domain-neutral).
 */
export class WorkflowSubscriberEventService implements IEventService {
    private tail: Promise<void> = Promise.resolve();
    private listeners = new Set<TEventListener>();

    constructor(
        private readonly subscriber: IWorkflowEventSubscriber,
        private readonly logger: ILogger = SilentLogger
    ) {}

    emit(eventType: string, data: IBaseEventData, context?: IEventContext): void {
        if (!(data.timestamp instanceof Date)) {
            throw new Error(`[PATH-ONLY] Missing or invalid timestamp for eventType=${String(eventType)}`);
        }
        if (!context?.ownerPath?.length) {
            throw new Error(`[PATH-ONLY] Missing context.ownerPath for eventType=${String(eventType)}`);
        }

        for (const seg of context.ownerPath) {
            if (typeof seg.type !== 'string' || seg.type.length === 0) {
                throw new Error('[PATH-ONLY] Invalid context.ownerPath (missing segment type) for workflow bridge');
            }
            if (typeof seg.id !== 'string' || seg.id.length === 0) {
                throw new Error('[PATH-ONLY] Invalid context.ownerPath (missing segment id) for workflow bridge');
            }
        }

        // Ignore conflicting envelope fields if they were injected into the data bag.
        const { context: _context, ownerPath: _ownerPath, timestamp: _timestamp, ...rest } = data;

        const payload: TEventData = {
            ...rest,
            eventType: String(eventType),
            timestamp: data.timestamp,
            context
        };

        this.tail = this.tail
            .then(async () => {
                await this.subscriber.processEvent(String(eventType), payload);
                this.notifyListeners(String(eventType), data, context);
            })
            .catch((error) => {
                const err = error instanceof Error ? error : new Error(String(error));
                // Strict policy: surface the error via logger (no fallback path).
                this.logger.error('WorkflowSubscriberEventService failed to process event', {
                    eventType: String(eventType),
                    error: err.message
                });
                throw err;
            });
    }

    subscribe(listener: TEventListener): void {
        this.listeners.add(listener);
    }

    unsubscribe(listener: TEventListener): void {
        this.listeners.delete(listener);
    }

    /**
     * Await all queued event processing.
     * Required for deterministic callers that export a snapshot after execution.
     */
    async flush(): Promise<void> {
        await this.tail;
    }

    private notifyListeners(eventType: string, data: IBaseEventData, context?: IEventContext): void {
        for (const listener of this.listeners) {
            listener(eventType, data, context);
        }
    }
}



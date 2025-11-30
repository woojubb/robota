import {
    EventService,
    ServiceEventType,
    ServiceEventData,
    EventContext,
    OwnerPathSegment,
    DEFAULT_EVENT_SERVICE
} from '@robota-sdk/agents';

/**
 * SubAgentEventRelay - Event relay for Sub-Agent to Parent connection
 * 
 * This class acts as a bridge between Sub-Agent events and the parent TeamContainer,
 * automatically enriching events with parent execution information for proper hierarchy.
 * 
 * Key Features:
 * - Inherits from ActionTrackingEventService for automatic hierarchy tracking
 * - Automatically adds parentExecutionId to all Sub-Agent events  
 * - Maintains proper execution levels for nested agent calls
 * - Preserves Robota object purity (no metadata pollution)
 * 
 * @example
 * ```typescript
 * const subAgentEventService = new SubAgentEventRelay(
 *   this.eventService,     // Parent TeamContainer's EventService
 *   toolExecutionId        // assignTask tool call ID as parent
 * );
 * 
 * const subAgent = new Robota({ 
 *   eventService: subAgentEventService  // Clean injection
 * });
 * ```
 */
export class SubAgentEventRelay implements EventService {
    private readonly parentEventService: EventService;
    private readonly parentToolCallId: string;

    constructor(parentEventService: EventService | undefined, parentToolCallId: string) {
        this.parentEventService = parentEventService || DEFAULT_EVENT_SERVICE;
        this.parentToolCallId = parentToolCallId;
    }

    /**
     * Emit event with direct parent ID provision (no inference needed)
     * Provides exact parentId for each event type to eliminate mapping/inference
     * Uses asynchronous processing to prevent event loop blocking
     * 
     * @param eventType - Type of event to emit
     * @param data - Event data
     */
    emit(eventType: ServiceEventType, data: ServiceEventData, context?: EventContext): void {
        // Synchronous forward to preserve strict ordering (no microtask deferral)
        try {
            const enrichedData: ServiceEventData = {
                ...data,
                parentExecutionId: data.parentExecutionId || this.parentToolCallId,
                executionLevel: (data.executionLevel || 0) + 1,
                sourceType: 'agent'
            };

            const relayContext = this.buildRelayContext(enrichedData, context);

            this.parentEventService.emit(eventType, enrichedData, relayContext);
        } catch (error) {
            console.error(`[SubAgentEventRelay] Error processing event ${eventType}:`, error);
        }
    }

    private buildRelayContext(data: ServiceEventData, context?: EventContext): EventContext {
        const basePath: OwnerPathSegment[] = context?.ownerPath ? [...context.ownerPath] : [];
        const hasParentSegment = basePath.some(segment => segment.id === this.parentToolCallId);
        if (!hasParentSegment) {
            basePath.push({ type: 'tool', id: this.parentToolCallId });
        }

        const agentId = context?.ownerId || data.sourceId || this.parentToolCallId;
        basePath.push({ type: 'agent', id: agentId });

        return {
            ownerType: 'agent',
            ownerId: agentId,
            ownerPath: basePath,
            sourceId: data.sourceId || context?.sourceId || agentId
        };
    }
}
import {
    EventService,
    ServiceEventType,
    ServiceEventData,
    EventContext,
    OwnerPathSegment,
    DEFAULT_ABSTRACT_EVENT_SERVICE,
    bindEventServiceOwner
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
    private childEventService?: EventService;

    constructor(parentEventService: EventService | undefined, parentToolCallId: string) {
        this.parentEventService = parentEventService || DEFAULT_ABSTRACT_EVENT_SERVICE;
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
        if (this.parentEventService === DEFAULT_ABSTRACT_EVENT_SERVICE) {
            return;
        }

        try {
            const relayContext = this.buildRelayContext(data, context);
            const childEventService = this.ensureChildEventService(relayContext);
            childEventService.emit(eventType, data, relayContext);
        } catch (error) {
            console.error(`[SubAgentEventRelay] Error processing event ${eventType}:`, error);
        }
    }

    private ensureChildEventService(context: EventContext): EventService {
        if (this.childEventService) {
            return this.childEventService;
        }

        if (!context.ownerId) {
            throw new Error('[SubAgentEventRelay] Unable to determine child agent ownerId');
        }

        this.childEventService = bindEventServiceOwner(this.parentEventService, {
            ownerType: 'agent',
            ownerId: context.ownerId,
            ownerPath: context.ownerPath,
            sourceType: 'agent',
            sourceId: context.ownerId
        });

        return this.childEventService;
    }

    private buildRelayContext(data: ServiceEventData, context?: EventContext): EventContext {
        const basePath: OwnerPathSegment[] = context?.ownerPath ? context.ownerPath.map(segment => ({ ...segment })) : [];
        if (!basePath.some(segment => segment.id === this.parentToolCallId)) {
            basePath.push({ type: 'tool', id: this.parentToolCallId });
        }

        const agentId = this.resolveAgentId(data, context);
        if (!agentId) {
            throw new Error('[SubAgentEventRelay] Missing agent identifier for relay context');
        }

        if (!basePath.some(segment => segment.type === 'agent' && segment.id === agentId)) {
            basePath.push({ type: 'agent', id: agentId });
        }

        return {
            ownerType: 'agent',
            ownerId: agentId,
            ownerPath: basePath
        };
    }

    private resolveAgentId(data: ServiceEventData, context?: EventContext): string | undefined {
        if (context?.ownerId) {
            return context.ownerId;
        }
        if (context?.ownerPath) {
            const reversed = [...context.ownerPath].reverse();
            const agentSegment = reversed.find(segment => segment.type === 'agent' && segment.id);
            if (agentSegment?.id) {
                return agentSegment.id;
            }
        }
        return data.sourceId;
    }
}
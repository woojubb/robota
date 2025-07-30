import {
    ActionTrackingEventService,
    EventService,
    ServiceEventType,
    ServiceEventData
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
export class SubAgentEventRelay extends ActionTrackingEventService {
    private readonly parentEventService: EventService;
    private readonly parentToolCallId: string;

    /**
     * Constructor for SubAgentEventRelay
     * @param parentEventService - The parent TeamContainer's EventService
     * @param parentToolCallId - The assignTask tool call ID that created this Sub-Agent
     */
    constructor(
        parentEventService: EventService,
        parentToolCallId: string
    ) {
        super();
        this.parentEventService = parentEventService;
        this.parentToolCallId = parentToolCallId;
    }

    /**
     * Emit event with automatic parent connection
     * Enriches all Sub-Agent events with parent execution information
     * 
     * @param eventType - Type of event to emit
     * @param data - Event data
     */
    emit(eventType: ServiceEventType, data: ServiceEventData): void {
        // Enrich Sub-Agent event with parent connection info
        const enrichedData: ServiceEventData = {
            ...data,
            parentExecutionId: this.parentToolCallId,  // 🔑 Connect to assignTask
            executionLevel: (data.executionLevel || 0) + 1,  // 🔑 Nested level
            sourceType: 'sub-agent'  // 🔑 Mark as Sub-Agent event
        };

        // Forward to parent EventService for unified hierarchy
        this.parentEventService.emit(eventType, enrichedData);
    }

    /**
     * Subscribe to events (delegate to parent)
     * @param eventType - Event type to subscribe to  
     * @param handler - Event handler function
     */
    on(eventType: ServiceEventType, handler: (data: ServiceEventData) => void): void {
        this.parentEventService.on(eventType, handler);
    }

    /**
     * Unsubscribe from events (delegate to parent)
     * @param eventType - Event type to unsubscribe from
     * @param handler - Event handler function to remove
     */
    off(eventType: ServiceEventType, handler: (data: ServiceEventData) => void): void {
        this.parentEventService.off(eventType, handler);
    }
}
import {
    EventService,
    ServiceEventType,
    ServiceEventData
} from '@robota-sdk/agents';
import { ActionTrackingEventService } from '@robota-sdk/agents';

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

    // 🗑️ executionToThinkingMap 제거: 표준 Agent Copy 시스템 사용

    /**
     * Constructor for SubAgentEventRelay
     * @param parentEventService - The parent TeamContainer's EventService
     * @param parentToolCallId - The assignTask tool call ID that created this Sub-Agent
     */
    constructor(
        parentEventService: EventService,
        parentToolCallId: string
    ) {
        // Initialize ActionTrackingEventService with parent's context and enforced prefix 'agent'
        super(parentEventService as any, undefined, {
            executionId: parentToolCallId,
            parentExecutionId: parentToolCallId,
            rootExecutionId: parentToolCallId,
            executionLevel: 2,
            executionPath: [parentToolCallId],
            sourceType: 'agent',
            sourceId: parentToolCallId
        } as any, { ownerPrefix: 'agent' });

        this.parentEventService = parentEventService;
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
    override emit(eventType: ServiceEventType, data: ServiceEventData): void {
        // Synchronous forward to preserve strict ordering (no microtask deferral)
        try {
            const enrichedData: ServiceEventData = {
                ...data,
                parentExecutionId: data.parentExecutionId || this.parentToolCallId,
                executionLevel: (data.executionLevel || 0) + 1,
                sourceType: 'agent'
            };

            this.parentEventService.emit(eventType, enrichedData);
        } catch (error) {
            console.error(`[SubAgentEventRelay] Error processing event ${eventType}:`, error);
        }
    }
}
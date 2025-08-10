import {
    EventService,
    ServiceEventType,
    ServiceEventData
} from '@robota-sdk/agents';
import { ContextualEventService } from '@robota-sdk/agents';

/**
 * SubAgentEventRelay - Event relay for Sub-Agent to Parent connection
 * 
 * This class acts as a bridge between Sub-Agent events and the parent TeamContainer,
 * automatically enriching events with parent execution information for proper hierarchy.
 * 
 * Key Features:
 * - Inherits from ContextualEventService for automatic hierarchy tracking
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
export class SubAgentEventRelay extends ContextualEventService {
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
        // Initialize ContextualEventService with parent's context
        // No need to re-define extractors - they are inherited from parent
        super({
            baseEventService: parentEventService,
            executionContext: {
                executionId: parentToolCallId,
                sourceType: 'team',
                sourceId: parentToolCallId,
                parentExecutionId: parentToolCallId,
                executionLevel: 2  // Tool level (team=1, tool=2)
            }
            // contextExtractors inherited from parentEventService automatically
        });

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
    emit(eventType: ServiceEventType, data: ServiceEventData): void {
        // Process event asynchronously to prevent blocking
        setTimeout(() => {
            try {
                // Parent injects the correct parentExecutionId; do not override if already provided
                let enrichedData: ServiceEventData = {
                    ...data,
                    parentExecutionId: data.parentExecutionId || this.parentToolCallId,
                    executionLevel: (data.executionLevel || 0) + 1,
                    sourceType: 'agent'
                };

                // 🎯 Agent Copy 시스템 통합: 독립적인 ID 생성 제거
                // WorkflowEventSubscriber의 표준 Agent Copy 시스템에서 예약된 ID 사용
                if (eventType === 'execution.assistant_message_start') {
                    // 표준 Agent Copy 시스템에서 thinking ID가 예약되어 제공됨
                    // SubAgentEventRelay는 단순히 이벤트를 전달만 함
                    enrichedData = {
                        ...enrichedData,
                        metadata: {
                            ...data.metadata,
                            // 🎯 표준 시스템 통합: 독립적인 thinkingNodeId 생성 제거
                            // WorkflowEventSubscriber에서 예약된 ID 사용
                        }
                    };
                }

                if (eventType === 'tool_call_start') {
                    // 🎯 표준 Agent Copy 시스템 통합: 독립적인 매핑 제거
                    // WorkflowEventSubscriber에서 agentToThinkingMap 사용
                    enrichedData = {
                        ...enrichedData,
                        metadata: {
                            ...data.metadata,
                            // 🎯 표준 시스템 통합: WorkflowEventSubscriber의 agentToThinkingMap 사용
                            // SubAgentEventRelay의 독립적인 executionToThinkingMap 제거
                        }
                    };
                }

                // Forward to parent EventService for unified hierarchy
                this.parentEventService.emit(eventType, enrichedData);
            } catch (error) {
                console.error(`[SubAgentEventRelay] Error processing event ${eventType}:`, error);
            }
        }, 0);
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
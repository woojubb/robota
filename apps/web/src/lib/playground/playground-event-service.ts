import { EventService, ServiceEventType, ServiceEventData } from '@robota-sdk/agents';

// Import the existing ConversationEvent type from PlaygroundHistoryPlugin
// This ensures type compatibility with the existing system

/**
 * Basic event types supported by PlaygroundHistoryPlugin
 */
type BasicEventType =
    | 'user_message'      // 사용자 입력
    | 'assistant_response' // LLM 응답  
    | 'tool_call'         // 도구 호출
    | 'tool_result'       // 도구 결과
    | 'error';            // 오류

/**
 * ConversationEvent interface matching PlaygroundHistoryPlugin
 */
export interface ConversationEvent {
    id: string;
    type: BasicEventType;
    timestamp: Date;
    content?: string;
    parentEventId?: string;
    childEventIds: string[];
    executionLevel: number;
    executionPath: string;
    agentId?: string;
    toolName?: string;
    delegationId?: string;
    parameters?: Record<string, unknown>;
    result?: unknown;
}

/**
 * History plugin interface that the PlaygroundEventService will interact with
 */
export interface PlaygroundHistoryPlugin {
    recordEvent(event: ConversationEvent): void;
}

/**
 * PlaygroundEventService implementation
 * Maps EventService events to ConversationEvent format for the Playground UI
 * 
 * This service acts as the bridge between the unified EventService system
 * and the Playground's existing history tracking mechanism.
 */
export class PlaygroundEventService implements EventService {
    private historyPlugin: PlaygroundHistoryPlugin;
    private eventCounter: number = 0;

    constructor(historyPlugin: PlaygroundHistoryPlugin) {
        this.historyPlugin = historyPlugin;
    }

    /**
     * Emit an event through the EventService interface
     * Maps ServiceEventType to ConversationEvent format and records it
     */
    emit(eventType: ServiceEventType, data: ServiceEventData): void {
        const conversationEvent = this.mapToConversationEvent(eventType, data);
        this.historyPlugin.recordEvent(conversationEvent);
    }

    /**
     * Map ServiceEventType and ServiceEventData to ConversationEvent format
     */
    private mapToConversationEvent(eventType: ServiceEventType, data: ServiceEventData): ConversationEvent {
        // Generate unique event ID
        const eventId = `${data.sourceType}-${data.sourceId}-${Date.now()}-${++this.eventCounter}`;

        // Map event type to ConversationEvent type
        const conversationEventType = this.mapEventType(eventType);

        // Build execution path if hierarchical data is available
        const executionPath = this.buildExecutionPath(data);

        // Infer execution level based on source type and context
        const executionLevel = this.inferExecutionLevel(data);

        return {
            id: eventId,
            type: conversationEventType,
            timestamp: data.timestamp || new Date(),
            content: this.buildEventContent(eventType, data),
            parentEventId: data.parentExecutionId,
            childEventIds: [], // Will be managed by PlaygroundHistoryPlugin
            executionLevel: executionLevel,
            executionPath: this.buildExecutionPathString(data),
            agentId: data.sourceType === 'agent' ? data.sourceId : undefined,
            toolName: data.toolName,
            delegationId: data.metadata?.delegationId,
            parameters: data.parameters,
            result: data.result
        };
    }

    /**
     * Map ServiceEventType to BasicEventType
     */
    private mapEventType(eventType: ServiceEventType): BasicEventType {
        switch (eventType) {
            case 'execution.start':
            case 'execution.complete':
            case 'task.assigned':
            case 'task.completed':
                return 'assistant_response'; // Execution events map to assistant responses

            case 'tool_call_start':
                return 'tool_call';

            case 'tool_call_complete':
                return 'tool_result';

            case 'execution.error':
            case 'tool_call_error':
                return 'error';

            default:
                return 'assistant_response'; // Default fallback
        }
    }

    /**
 * Build execution path from hierarchical data
 */
    private buildExecutionPath(data: ServiceEventData): string[] {
        if (data.executionPath && Array.isArray(data.executionPath)) {
            return data.executionPath;
        }

        // Build path based on available context
        const path: string[] = [];

        if (data.rootExecutionId) {
            path.push(`root:${data.rootExecutionId}`);
        }

        if (data.parentExecutionId) {
            path.push(`parent:${data.parentExecutionId}`);
        }

        path.push(`${data.sourceType}:${data.sourceId}`);

        if (data.toolName) {
            path.push(`tool:${data.toolName}`);
        }

        return path;
    }

    /**
     * Build execution path as string for PlaygroundHistoryPlugin
     */
    private buildExecutionPathString(data: ServiceEventData): string {
        const pathArray = this.buildExecutionPath(data);
        return pathArray.join('→');
    }

    /**
     * Build content string for ConversationEvent
     */
    private buildEventContent(eventType: ServiceEventType, data: ServiceEventData): string {
        switch (eventType) {
            case 'execution.start':
                return `🚀 Execution started: ${data.sourceType} ${data.sourceId}`;
            case 'execution.complete':
                return `✅ Execution completed: ${data.result || 'Success'}`;
            case 'execution.error':
                return `❌ Execution failed: ${data.error}`;
            case 'tool_call_start':
                return `🔧 Tool call started: ${data.toolName}`;
            case 'tool_call_complete':
                return `✅ Tool call completed: ${data.toolName}`;
            case 'tool_call_error':
                return `❌ Tool call failed: ${data.toolName} - ${data.error}`;
            case 'task.assigned':
                return `📋 Task assigned: ${data.taskDescription}`;
            case 'task.completed':
                return `✅ Task completed: ${data.taskDescription}`;
            default:
                return `ℹ️ Event: ${eventType}`;
        }
    }

    /**
     * Infer execution level based on source type and context
     */
    private inferExecutionLevel(data: ServiceEventData): number {
        // If explicitly provided, use it
        if (typeof data.executionLevel === 'number') {
            return data.executionLevel;
        }

        // Infer based on source type and hierarchy
        if (data.sourceType === 'team') {
            return 0; // Team is top level
        }

        if (data.sourceType === 'agent') {
            return data.parentExecutionId ? 1 : 0; // Agent is level 1 if delegated, 0 if direct
        }

        if (data.sourceType === 'tool') {
            return data.parentExecutionId ? 2 : 1; // Tool is level 2 if in delegation, 1 if direct
        }

        return 0; // Default fallback
    }
}

/**
 * Factory function to create PlaygroundEventService
 */
export function createPlaygroundEventService(historyPlugin: PlaygroundHistoryPlugin): PlaygroundEventService {
    return new PlaygroundEventService(historyPlugin);
} 
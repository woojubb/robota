// Temporarily use any to avoid type conflicts during development
import { EventService, ServiceEventData } from '@robota-sdk/agents';

// Local ServiceEventType with extended events for detailed block tree
type ServiceEventType =
    | 'execution.start' | 'execution.complete' | 'execution.error'
    | 'tool_call_start' | 'tool_call_complete' | 'tool_call_error'
    | 'task.assigned' | 'task.completed'
    | 'team.analysis_start' | 'team.analysis_complete'
    | 'agent.creation_start' | 'agent.creation_complete'
    | 'agent.execution_start' | 'agent.execution_complete'
    | 'subtool.call_start' | 'subtool.call_complete' | 'subtool.call_error'
    | 'task.aggregation_start' | 'task.aggregation_complete';

// Import BasicEventType from PlaygroundHistoryPlugin for type consistency
type BasicEventType =
    | 'user_message'
    | 'assistant_response'
    | 'tool_call_start'
    | 'tool_call_complete'
    | 'tool_call_error'
    | 'execution.start'
    | 'execution.complete'
    | 'execution.error'
    | 'task.assigned'
    | 'task.completed'
    | 'team.analysis_start'
    | 'team.analysis_complete'
    | 'agent.creation_start'
    | 'agent.creation_complete'
    | 'agent.execution_start'
    | 'agent.execution_complete'
    | 'subtool.call_start'
    | 'subtool.call_complete'
    | 'subtool.call_error'
    | 'task.aggregation_start'
    | 'task.aggregation_complete';

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
    error?: string;
    metadata?: Record<string, unknown>;
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

        // PlaygroundHistoryPlugin.recordEvent expects partial event without auto-generated fields
        const partialEvent = {
            type: conversationEvent.type,
            content: conversationEvent.content,
            parentEventId: conversationEvent.parentEventId,
            agentId: conversationEvent.agentId,
            toolName: conversationEvent.toolName,
            delegationId: conversationEvent.delegationId,
            parameters: conversationEvent.parameters,
            result: conversationEvent.result,
            error: conversationEvent.error,
            metadata: conversationEvent.metadata
        } as any; // Type assertion to work around interface mismatch

        this.historyPlugin.recordEvent(partialEvent);
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
            result: data.result,
            error: data.error,
            metadata: data.metadata
        };
    }

    /**
     * Map ServiceEventType to BasicEventType
     */
    private mapEventType(eventType: ServiceEventType): BasicEventType {
        switch (eventType) {
            case 'execution.start':
                return 'execution.start';
            case 'execution.complete':
                return 'execution.complete';
            case 'execution.error':
                return 'execution.error';

            case 'task.assigned':
                return 'task.assigned';
            case 'task.completed':
                return 'task.completed';

            case 'tool_call_start':
                return 'tool_call_start';
            case 'tool_call_complete':
                return 'tool_call_complete';
            case 'tool_call_error':
                return 'tool_call_error';

            // 새로운 상세 이벤트 타입들
            case 'team.analysis_start':
                return 'team.analysis_start';
            case 'team.analysis_complete':
                return 'team.analysis_complete';

            case 'agent.creation_start':
                return 'agent.creation_start';
            case 'agent.creation_complete':
                return 'agent.creation_complete';

            case 'agent.execution_start':
                return 'agent.execution_start';
            case 'agent.execution_complete':
                return 'agent.execution_complete';

            case 'subtool.call_start':
                return 'subtool.call_start';
            case 'subtool.call_complete':
                return 'subtool.call_complete';
            case 'subtool.call_error':
                return 'subtool.call_error';

            case 'task.aggregation_start':
                return 'task.aggregation_start';
            case 'task.aggregation_complete':
                return 'task.aggregation_complete';

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
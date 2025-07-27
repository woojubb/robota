// Types for EventService interface (will import from @robota-sdk/agents when available)
export type ServiceEventType =
    | 'execution.start' | 'execution.complete' | 'execution.error'
    | 'tool_call_start' | 'tool_call_complete' | 'tool_call_error'
    | 'task.assigned' | 'task.completed';

export interface ServiceEventData {
    sourceType: 'agent' | 'team' | 'tool';
    sourceId: string;
    timestamp?: Date;
    parentExecutionId?: string;
    rootExecutionId?: string;
    executionLevel?: number;
    executionPath?: string[];
    toolName?: string;
    parameters?: any;
    result?: any;
    error?: string;
    taskDescription?: string;
    metadata?: Record<string, any>;
    [key: string]: any;
}

export interface EventService {
    emit(eventType: ServiceEventType, data: ServiceEventData): void;
}

/**
 * ConversationEvent interface for Playground UI
 * Matches the existing structure used by PlaygroundHistoryPlugin
 */
export interface ConversationEvent {
    id: string;
    type: 'execution_start' | 'execution_complete' | 'execution_error' |
    'tool_call_start' | 'tool_call_complete' | 'tool_call_error' |
    'task_assigned' | 'task_completed';
    sourceType: 'agent' | 'team' | 'tool';
    sourceId: string;
    timestamp: Date;
    data: {
        toolName?: string;
        parameters?: any;
        result?: any;
        error?: string;
        taskDescription?: string;
        duration?: number;
        parentExecutionId?: string;
        rootExecutionId?: string;
        executionLevel?: number;
        executionPath?: string[];
        metadata?: Record<string, any>;
        [key: string]: any;
    };
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
            sourceType: data.sourceType,
            sourceId: data.sourceId,
            timestamp: data.timestamp || new Date(),
            data: {
                toolName: data.toolName,
                parameters: data.parameters,
                result: data.result,
                error: data.error,
                taskDescription: data.taskDescription,
                duration: data.metadata?.duration,
                parentExecutionId: data.parentExecutionId,
                rootExecutionId: data.rootExecutionId,
                executionLevel: executionLevel,
                executionPath: executionPath,
                metadata: {
                    ...data.metadata,
                    originalEventType: eventType,
                    sourceType: data.sourceType,
                    sourceId: data.sourceId
                },
                // Include any additional data fields
                ...Object.fromEntries(
                    Object.entries(data).filter(([key]) =>
                        !['sourceType', 'sourceId', 'timestamp', 'toolName', 'parameters',
                            'result', 'error', 'taskDescription', 'parentExecutionId',
                            'rootExecutionId', 'executionLevel', 'executionPath', 'metadata'].includes(key)
                    )
                )
            }
        };
    }

    /**
     * Map ServiceEventType to ConversationEvent type
     */
    private mapEventType(eventType: ServiceEventType): ConversationEvent['type'] {
        switch (eventType) {
            case 'execution.start':
                return 'execution_start';
            case 'execution.complete':
                return 'execution_complete';
            case 'execution.error':
                return 'execution_error';
            case 'tool_call_start':
                return 'tool_call_start';
            case 'tool_call_complete':
                return 'tool_call_complete';
            case 'tool_call_error':
                return 'tool_call_error';
            case 'task.assigned':
                return 'task_assigned';
            case 'task.completed':
                return 'task_completed';
            default:
                // Fallback for unknown event types
                return 'execution_start';
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
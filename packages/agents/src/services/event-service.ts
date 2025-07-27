/**
 * EventService - Unified event emission system for Team/Agent/Tool integration
 * 
 * Architectural Principles:
 * - Built-in Service: Same pattern as ExecutionService
 * - Dependency Injection: Optional injection for flexibility
 * - Single Event Handler: emit(eventType, data) method only
 * - Architecture Consistency: 100% aligned with Robota SDK patterns
 */

import { SimpleLogger, SilentLogger, DefaultConsoleLogger } from '../utils/simple-logger';

/**
 * Service event types for unified tracking across Team/Agent/Tool
 */
export type ServiceEventType =
    | 'execution.start'      // Agent/Team execution started
    | 'execution.complete'   // Agent/Team execution completed
    | 'execution.error'      // Agent/Team execution failed
    | 'tool_call_start'      // Tool execution started
    | 'tool_call_complete'   // Tool execution completed
    | 'tool_call_error'      // Tool execution failed
    | 'task.assigned'        // Team task assignment
    | 'task.completed';      // Team task completion

/**
 * Service event data structure with hierarchical tracking information
 */
export interface ServiceEventData {
    /** Source type: agent, team, or tool */
    sourceType: 'agent' | 'team' | 'tool';

    /** Source identifier (agent ID, team ID, etc.) */
    sourceId: string;

    /** Event timestamp (auto-generated if not provided) */
    timestamp?: Date;

    // Hierarchical tracking information (extracted from ToolExecutionContext)
    /** Parent execution ID for hierarchical tracking */
    parentExecutionId?: string;

    /** Root execution ID (Team/Agent level) */
    rootExecutionId?: string;

    /** Execution depth level (0: Team, 1: Agent, 2: Tool) */
    executionLevel?: number;

    /** Execution path array for complete hierarchy */
    executionPath?: string[];

    // Event-specific data
    /** Tool name for tool-related events */
    toolName?: string;

    /** Parameters passed to tool/agent */
    parameters?: any;

    /** Result from tool/agent execution */
    result?: any;

    /** Error message for error events */
    error?: string;

    /** Task description for task events */
    taskDescription?: string;

    /** Additional metadata */
    metadata?: Record<string, any>;

    /** Allow additional properties for extensibility */
    [key: string]: any;
}

/**
 * EventService interface - Single event emission point
 */
export interface EventService {
    /**
     * Emit an event with data
     * @param eventType - Type of event to emit
     * @param data - Event data with hierarchical information
     */
    emit(eventType: ServiceEventType, data: ServiceEventData): void;
}

/**
 * Silent event service - No-op implementation (default)
 * Used when no specific event handling is needed
 */
export class SilentEventService implements EventService {
    emit(eventType: ServiceEventType, data: ServiceEventData): void {
        // No-op: Silent operation for performance
    }
}

/**
 * Default console event service - Basic logging implementation
 * Useful for development and debugging
 */
export class DefaultEventService implements EventService {
    private readonly logger: SimpleLogger;

    constructor(logger?: SimpleLogger) {
        this.logger = logger || DefaultConsoleLogger;
    }

    emit(eventType: ServiceEventType, data: ServiceEventData): void {
        const timestamp = data.timestamp || new Date();
        const logData = {
            eventType,
            sourceType: data.sourceType,
            sourceId: data.sourceId,
            timestamp: timestamp.toISOString(),
            executionLevel: data.executionLevel,
            executionPath: data.executionPath?.join('→'),
            ...(data.toolName && { toolName: data.toolName }),
            ...(data.taskDescription && { taskDescription: data.taskDescription }),
            ...(data.error && { error: data.error })
        };

        this.logger.info(`🔔 [${eventType}]`, logData);
    }
}

/**
 * Structured event service - Enhanced logging with metadata
 * Provides detailed structured logging for analysis
 */
export class StructuredEventService implements EventService {
    private readonly logger: SimpleLogger;

    constructor(logger?: SimpleLogger) {
        this.logger = logger || DefaultConsoleLogger;
    }

    emit(eventType: ServiceEventType, data: ServiceEventData): void {
        const timestamp = data.timestamp || new Date();
        const eventId = this.generateEventId();

        const structuredEvent = {
            id: eventId,
            type: eventType,
            timestamp: timestamp.toISOString(),
            source: {
                type: data.sourceType,
                id: data.sourceId
            },
            hierarchy: {
                level: data.executionLevel || 0,
                path: data.executionPath || [],
                parentId: data.parentExecutionId,
                rootId: data.rootExecutionId
            },
            payload: {
                ...(data.toolName && { toolName: data.toolName }),
                ...(data.parameters && { parameters: data.parameters }),
                ...(data.result && { result: data.result }),
                ...(data.error && { error: data.error }),
                ...(data.taskDescription && { taskDescription: data.taskDescription }),
                ...(data.metadata && { metadata: data.metadata })
            }
        };

        this.logger.info(`📊 [STRUCTURED_EVENT]`, structuredEvent);
    }

    private generateEventId(): string {
        return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
} 
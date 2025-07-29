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
 * Extended for detailed block tree visualization
 */
export type ServiceEventType =
    | 'execution.start'           // Agent/Team execution started
    | 'execution.complete'        // Agent/Team execution completed
    | 'execution.error'           // Agent/Team execution failed
    | 'tool_call_start'           // Tool execution started
    | 'tool_call_complete'        // Tool execution completed
    | 'tool_call_error'           // Tool execution failed
    | 'task.assigned'             // Team task assignment
    | 'task.completed'            // Team task completion
    | 'team.analysis_start'       // Team job analysis started
    | 'team.analysis_complete'    // Team job analysis completed
    | 'agent.creation_start'      // Agent creation process started
    | 'agent.creation_complete'   // Agent creation process completed
    | 'agent.execution_start'     // Individual agent execution started
    | 'agent.execution_complete'  // Individual agent execution completed
    | 'subtool.call_start'        // Agent internal tool call started
    | 'subtool.call_complete'     // Agent internal tool call completed
    | 'subtool.call_error'        // Agent internal tool call failed
    | 'task.aggregation_start'    // Task result aggregation started
    | 'task.aggregation_complete'; // Task result aggregation completed      // Team task completion

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
 * Execution node for hierarchy tracking
 * Represents a single execution instance in the execution tree
 */
export interface ExecutionNode {
    /** Unique execution ID */
    id: string;

    /** Parent execution ID (undefined for root) */
    parentId?: string;

    /** Execution level (0=Team, 1=Agent, 2=Tool) */
    level: number;

    /** Child execution IDs */
    children: string[];

    /** Execution metadata */
    metadata?: {
        toolName?: string;
        startTime?: Date;
        source?: string;
        [key: string]: any;
    };
}

/**
 * EventService interface - Single event emission point
 * 
 * Enhanced with optional methods for hierarchical tracking.
 * These methods are detected via Duck Typing pattern for zero-configuration.
 */
export interface EventService {
    /**
     * Emit an event with data
     * @param eventType - Type of event to emit
     * @param data - Event data with hierarchical information
     */
    emit(eventType: ServiceEventType, data: ServiceEventData): void;

    /**
     * Optional: Track execution hierarchy (Duck Typing detection)
     * Enables automatic hierarchical context for all events
     * 
     * @param executionId - Unique execution ID
     * @param parentExecutionId - Parent execution ID
     * @param level - Execution level (0=Team, 1=Agent, 2=Tool)
     */
    trackExecution?(executionId: string, parentExecutionId?: string, level?: number): void;

    /**
     * Optional: Create bound emit function with automatic context (Duck Typing detection)
     * Returns an emit function that automatically includes hierarchical context
     * 
     * @param executionId - Execution ID to bind context to
     * @returns Bound emit function with automatic parent/level context
     */
    createBoundEmit?(executionId: string): (eventType: ServiceEventType, data: ServiceEventData) => void;
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

/**
 * ActionTrackingEventService - Enhanced EventService with automatic hierarchy tracking
 * 
 * Wraps any base EventService and adds automatic hierarchical context to all events.
 * Uses Duck Typing pattern for zero-configuration integration with existing code.
 * 
 * Key Features:
 * - Automatic parent-child relationship tracking
 * - Execution level inference (Team=0, Agent=1, Tool=2)
 * - Bound emit functions with pre-filled context
 * - Full backward compatibility with base EventService
 * 
 * @example
 * ```typescript
 * const enhanced = new ActionTrackingEventService(new PlaygroundEventService());
 * 
 * // Track execution hierarchy
 * enhanced.trackExecution('agent-001', 'team-main', 1);
 * 
 * // Create bound emit with automatic context
 * const boundEmit = enhanced.createBoundEmit('agent-001');
 * boundEmit('execution.start', { sourceType: 'agent', sourceId: 'agent-001' });
 * // Automatically includes: parentExecutionId: 'team-main', executionLevel: 1
 * ```
 */
export class ActionTrackingEventService implements EventService {
    private readonly baseEventService: EventService;
    private readonly executionHierarchy: Map<string, ExecutionNode> = new Map();

    constructor(baseEventService?: EventService) {
        this.baseEventService = baseEventService || new SilentEventService();
    }

    /**
     * Standard emit method - forwards to base service with enriched hierarchy data
     */
    emit(eventType: ServiceEventType, data: ServiceEventData): void {
        const enrichedData = this.enrichWithHierarchy(data);
        this.baseEventService.emit(eventType, enrichedData);
    }

    /**
     * Track execution in the hierarchy
     * Registers a new execution node with parent-child relationships
     */
    trackExecution(executionId: string, parentExecutionId?: string, level?: number): void {
        // Infer level from parent if not provided
        const inferredLevel = level ?? this.inferLevelFromParent(parentExecutionId);

        // Add child reference to parent
        if (parentExecutionId && this.executionHierarchy.has(parentExecutionId)) {
            const parent = this.executionHierarchy.get(parentExecutionId)!;
            if (!parent.children.includes(executionId)) {
                parent.children.push(executionId);
            }
        }

        // Register execution node
        this.executionHierarchy.set(executionId, {
            id: executionId,
            parentId: parentExecutionId,
            level: inferredLevel,
            children: [],
            metadata: {
                startTime: new Date(),
                source: 'ActionTrackingEventService'
            }
        });
    }

    /**
     * Create bound emit function with automatic hierarchical context
     * Returns a function that automatically includes parent/level information
     */
    createBoundEmit(executionId: string): (eventType: ServiceEventType, data: ServiceEventData) => void {
        return (eventType: ServiceEventType, data: ServiceEventData) => {
            const node = this.executionHierarchy.get(executionId);

            const enrichedData: ServiceEventData = {
                ...data,
                parentExecutionId: node?.parentId,
                rootExecutionId: this.findRootId(executionId),
                executionLevel: node?.level,
                executionPath: this.buildExecutionPath(executionId)
            };

            this.emit(eventType, enrichedData);
        };
    }

    /**
     * Enrich event data with available hierarchy information
     */
    private enrichWithHierarchy(data: ServiceEventData): ServiceEventData {
        // If data already has all hierarchy info, return as-is
        if (data.parentExecutionId && data.executionLevel !== undefined && data.executionPath) {
            return data;
        }

        // Try to find execution info from sourceId or other identifiers
        const executionId = this.findExecutionId(data);
        if (!executionId) {
            return data;
        }

        const node = this.executionHierarchy.get(executionId);
        if (!node) {
            return data;
        }

        return {
            ...data,
            parentExecutionId: data.parentExecutionId || node.parentId,
            rootExecutionId: data.rootExecutionId || this.findRootId(executionId),
            executionLevel: data.executionLevel ?? node.level,
            executionPath: data.executionPath || this.buildExecutionPath(executionId)
        };
    }

    /**
     * Infer execution level from parent node
     */
    private inferLevelFromParent(parentExecutionId?: string): number {
        if (!parentExecutionId) {
            return 0; // Root level (Team)
        }

        const parent = this.executionHierarchy.get(parentExecutionId);
        if (!parent) {
            return 1; // Default to Agent level
        }

        return parent.level + 1;
    }

    /**
     * Find root execution ID by traversing up the hierarchy
     */
    private findRootId(executionId: string): string {
        const node = this.executionHierarchy.get(executionId);
        if (!node || !node.parentId) {
            return executionId; // This is the root
        }

        return this.findRootId(node.parentId);
    }

    /**
     * Build execution path array from root to current execution
     */
    private buildExecutionPath(executionId: string): string[] {
        const path: string[] = [];
        let currentId: string | undefined = executionId;

        while (currentId) {
            path.unshift(currentId);
            const node = this.executionHierarchy.get(currentId);
            currentId = node?.parentId;
        }

        return path;
    }

    /**
     * Try to find execution ID from event data
     */
    private findExecutionId(data: ServiceEventData): string | undefined {
        // Try various fields that might contain execution ID
        return data.sourceId || data.agentId || data.toolName || undefined;
    }

    /**
     * Get current hierarchy state (for debugging)
     */
    getHierarchy(): Map<string, ExecutionNode> {
        return new Map(this.executionHierarchy);
    }

    /**
     * Clear hierarchy state
     */
    clearHierarchy(): void {
        this.executionHierarchy.clear();
    }
} 
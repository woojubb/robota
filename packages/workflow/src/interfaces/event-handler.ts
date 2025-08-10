// Event Handler Interfaces
// Domain-neutral event processing system

import type { WorkflowNode } from './workflow-node.js';
import type { WorkflowEdge } from './workflow-edge.js';
import type { WorkflowUpdate } from './workflow-builder.js';

/**
 * Event handler priority levels
 */
export enum HandlerPriority {
    LOWEST = 0,
    LOW = 25,
    NORMAL = 50,
    HIGH = 75,
    HIGHEST = 100
}

/**
 * Event pattern matching types
 */
export type EventPattern = string | RegExp | ((eventType: string) => boolean);

/**
 * Event data structure (domain-neutral)
 */
export interface EventData {
    // Core event information
    eventType: string;
    timestamp: Date;

    // Source information
    sourceType?: string;
    sourceId?: string;

    // Execution context
    executionId?: string;
    parentExecutionId?: string;
    rootExecutionId?: string;
    executionLevel?: number;

    /**
     * Branch anchor identifier (common parent for a fork)
     * Handlers should set node.parentId = parentId (metadata only; edges are prev-based)
     */
    parentId?: string;

    /**
     * Previous node identifier (immediately preceding node in the flow)
     * Subscriber builds edges using prevId → node.id to guarantee single inbound
     */
    prevId?: string;

    /**
     * Previous node identifiers (batch join). When provided, the subscriber will
     * create one inbound edge per id in prevIds, enabling fork-join connections
     * (e.g., connecting many tool_response nodes to a single aggregation node).
     */
    prevIds?: string[];

    // Event payload (flexible)
    parameters?: Record<string, unknown>;
    result?: Record<string, unknown>;
    metadata?: Record<string, unknown>;

    // Error information
    error?: Error | string;

    // Extensible data
    [key: string]: unknown;
}

/**
 * Event processing result
 */
export interface EventProcessingResult {
    success: boolean;
    updates: WorkflowUpdate[];
    errors?: string[];
    warnings?: string[];
    metadata?: Record<string, unknown>;
}

/**
 * Core event handler interface
 */
export interface EventHandler {
    /**
     * Handler identification
     */
    readonly name: string;
    readonly priority: HandlerPriority;
    readonly patterns: EventPattern[];

    /**
     * Check if this handler can process the event
     */
    canHandle(eventType: string, eventData?: EventData): boolean;

    /**
     * Process the event and return workflow updates
     */
    handle(eventType: string, eventData: EventData): Promise<EventProcessingResult>;

    /**
     * Initialize handler (optional)
     */
    initialize?(): Promise<void>;

    /**
     * Cleanup handler (optional)
     */
    destroy?(): Promise<void>;

    /**
     * Get handler statistics
     */
    getStats?(): {
        eventsProcessed: number;
        successCount: number;
        errorCount: number;
        averageProcessingTime: number;
        lastProcessedAt?: Date;
    };
}

/**
 * Extended event handler with configuration
 */
export interface ConfigurableEventHandler extends EventHandler {
    /**
     * Handler configuration
     */
    configure(config: EventHandlerConfig): void;

    /**
     * Get current configuration
     */
    getConfig(): EventHandlerConfig;
}

/**
 * Event handler configuration
 */
export interface EventHandlerConfig {
    enabled?: boolean;
    priority?: HandlerPriority;
    patterns?: EventPattern[];
    options?: Record<string, unknown>;
    logger?: {
        debug: (message: string, ...args: unknown[]) => void;
        info: (message: string, ...args: unknown[]) => void;
        warn: (message: string, ...args: unknown[]) => void;
        error: (message: string, ...args: unknown[]) => void;
    };
}

/**
 * Event handler factory interface
 */
export interface EventHandlerFactory {
    /**
     * Create handler instance
     */
    create(config?: EventHandlerConfig): EventHandler;

    /**
     * Get handler type information
     */
    getHandlerInfo(): {
        name: string;
        version: string;
        description: string;
        supportedEventTypes: string[];
    };

    /**
     * Validate configuration
     */
    validateConfig(config: EventHandlerConfig): {
        isValid: boolean;
        errors: string[];
    };
}

/**
 * Event handler registry interface
 */
export interface EventHandlerRegistry {
    /**
     * Register event handler
     */
    register(handler: EventHandler): void;

    /**
     * Unregister event handler
     */
    unregister(handlerName: string): boolean;

    /**
     * Get handler by name
     */
    getHandler(name: string): EventHandler | undefined;

    /**
     * Get all handlers
     */
    getAllHandlers(): EventHandler[];

    /**
     * Get handlers for event type
     */
    getHandlersForEvent(eventType: string): EventHandler[];

    /**
     * Clear all handlers
     */
    clear(): void;
}

/**
 * Event processing context
 */
export interface EventProcessingContext {
    /**
     * Current workflow state
     */
    currentNodes: Map<string, WorkflowNode>;
    currentEdges: Map<string, WorkflowEdge>;

    /**
     * Processing metadata
     */
    processingId: string;
    startTime: Date;
    retryCount?: number;

    /**
     * Helper functions
     */
    createNode: (nodeData: Omit<WorkflowNode, 'timestamp'>) => WorkflowNode;
    createEdge: (edgeData: Omit<WorkflowEdge, 'timestamp'>) => WorkflowEdge;
    findNode: (nodeId: string) => WorkflowNode | undefined;
    findEdge: (edgeId: string) => WorkflowEdge | undefined;

    /**
     * Logger
     */
    logger: {
        debug: (message: string, ...args: unknown[]) => void;
        info: (message: string, ...args: unknown[]) => void;
        warn: (message: string, ...args: unknown[]) => void;
        error: (message: string, ...args: unknown[]) => void;
    };
}

/**
 * Context-aware event handler interface
 */
export interface ContextualEventHandler extends EventHandler {
    /**
     * Process event with full context
     */
    handleWithContext(
        eventType: string,
        eventData: EventData,
        context: EventProcessingContext
    ): Promise<EventProcessingResult>;
}

/**
 * Utility functions for event handling
 */
export class EventHandlerUtils {
    /**
     * Create event pattern from string with wildcards
     */
    static createPattern(pattern: string): RegExp {
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const withWildcards = escaped.replace(/\\\*/g, '.*').replace(/\\\?/g, '.');
        return new RegExp(`^${withWildcards}$`);
    }

    /**
     * Test if event matches pattern
     */
    static matchesPattern(eventType: string, pattern: EventPattern): boolean {
        if (typeof pattern === 'string') {
            return pattern === eventType || eventType.startsWith(pattern);
        } else if (pattern instanceof RegExp) {
            return pattern.test(eventType);
        } else if (typeof pattern === 'function') {
            return pattern(eventType);
        }
        return false;
    }

    /**
     * Sort handlers by priority (highest first)
     */
    static sortHandlersByPriority(handlers: EventHandler[]): EventHandler[] {
        return [...handlers].sort((a, b) => b.priority - a.priority);
    }
}

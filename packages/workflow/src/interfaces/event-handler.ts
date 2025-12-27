// Event Handler Interfaces
// Domain-neutral event processing system

import type { IWorkflowNode } from './workflow-node.js';
import type { IWorkflowEdge } from './workflow-edge.js';
import type { TWorkflowUpdate } from './workflow-builder.js';
import type { IBaseEventData, IEventContext, IToolResult, TContextData, TLoggerData, TToolParameters, TUniversalValue } from '@robota-sdk/agents';

export type TWorkflowEventExtensionValue =
    | TUniversalValue
    | Date
    | Error
    | TLoggerData
    | TToolParameters
    | IToolResult
    | TContextData
    | IEventContext;

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
export type TEventPattern = string | RegExp | ((eventType: string) => boolean);

/**
 * Event data structure (domain-neutral)
 */
export type TEventData =
    // IMPORTANT:
    // - Event axis is owned by @robota-sdk/agents. Workflow must not redefine it.
    // - Workflow only composes the event envelope with stricter requirements.
    Omit<IBaseEventData, 'eventType' | 'timestamp' | 'parameters' | 'result' | 'error'> & {
        // Core event information (required in workflow processing)
        eventType: string;
        timestamp: Date;

        /**
         * Path-only: ownerPath-only context.
         * All relationship derivation MUST be done through context.ownerPath, not inferred IDs.
         */
        context: IEventContext;

        // Event payload (flexible, still domain-neutral)
        parameters?: TContextData;
        result?: IToolResult | TContextData;

        // Error information (workflow accepts both Error and string)
        error?: Error | string;

        // Workflow processing metadata (handler-level stats, etc.)
        metadata?: TLoggerData;

        // Extensible data (kept for backward compatibility during migration)
        [key: string]: TWorkflowEventExtensionValue | undefined;
    };

/**
 * Event processing result
 */
export interface IEventProcessingResult {
    success: boolean;
    updates: TWorkflowUpdate[];
    errors?: string[];
    warnings?: string[];
    metadata?: TLoggerData;
}

/**
 * Core event handler interface
 */
export interface IEventHandler {
    /**
     * Handler identification
     */
    readonly name: string;
    readonly priority: HandlerPriority;
    readonly patterns: TEventPattern[];

    /**
     * Check if this handler can process the event
     */
    canHandle(eventType: string, eventData?: TEventData): boolean;

    /**
     * Process the event and return workflow updates
     */
    handle(eventType: string, eventData: TEventData): Promise<IEventProcessingResult>;

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
export interface IConfigurableEventHandler extends IEventHandler {
    /**
     * Handler configuration
     */
    configure(config: IEventHandlerConfig): void;

    /**
     * Get current configuration
     */
    getConfig(): IEventHandlerConfig;
}

/**
 * Event handler configuration
 */
export interface IEventHandlerConfig {
    enabled?: boolean;
    priority?: HandlerPriority;
    patterns?: TEventPattern[];
    options?: Record<string, TWorkflowEventExtensionValue | undefined>;
    logger?: {
        debug: (message: string, ...args: TWorkflowEventExtensionValue[]) => void;
        info: (message: string, ...args: TWorkflowEventExtensionValue[]) => void;
        warn: (message: string, ...args: TWorkflowEventExtensionValue[]) => void;
        error: (message: string, ...args: TWorkflowEventExtensionValue[]) => void;
    };
}

/**
 * Event handler factory interface
 */
export interface IEventHandlerFactory {
    /**
     * Create handler instance
     */
    create(config?: IEventHandlerConfig): IEventHandler;

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
    validateConfig(config: IEventHandlerConfig): {
        isValid: boolean;
        errors: string[];
    };
}

/**
 * Event handler registry interface
 */
export interface IEventHandlerRegistry {
    /**
     * Register event handler
     */
    register(handler: IEventHandler): void;

    /**
     * Unregister event handler
     */
    unregister(handlerName: string): boolean;

    /**
     * Get handler by name
     */
    getHandler(name: string): IEventHandler | undefined;

    /**
     * Get all handlers
     */
    getAllHandlers(): IEventHandler[];

    /**
     * Get handlers for event type
     */
    getHandlersForEvent(eventType: string): IEventHandler[];

    /**
     * Clear all handlers
     */
    clear(): void;
}

/**
 * Event processing context
 */
export interface IEventProcessingContext {
    /**
     * Current workflow state
     */
    currentNodes: Map<string, IWorkflowNode>;
    currentEdges: Map<string, IWorkflowEdge>;

    /**
     * Processing metadata
     */
    processingId: string;
    startTime: Date;
    retryCount?: number;

    /**
     * Helper functions
     */
    createNode: (nodeData: Omit<IWorkflowNode, 'timestamp'>) => IWorkflowNode;
    createEdge: (edgeData: Omit<IWorkflowEdge, 'timestamp'>) => IWorkflowEdge;
    findNode: (nodeId: string) => IWorkflowNode | undefined;
    findEdge: (edgeId: string) => IWorkflowEdge | undefined;

    /**
     * Logger
     */
    logger: {
        debug: (message: string, ...args: TWorkflowEventExtensionValue[]) => void;
        info: (message: string, ...args: TWorkflowEventExtensionValue[]) => void;
        warn: (message: string, ...args: TWorkflowEventExtensionValue[]) => void;
        error: (message: string, ...args: TWorkflowEventExtensionValue[]) => void;
    };
}

/**
 * Context-aware event handler interface
 */
export interface IContextualEventHandler extends IEventHandler {
    /**
     * Process event with full context
     */
    handleWithContext(
        eventType: string,
        eventData: TEventData,
        context: IEventProcessingContext
    ): Promise<IEventProcessingResult>;
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
    static matchesPattern(eventType: string, pattern: TEventPattern): boolean {
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
    static sortHandlersByPriority(handlers: IEventHandler[]): IEventHandler[] {
        return [...handlers].sort((a, b) => b.priority - a.priority);
    }
}

import type { Message, RunOptions } from '../interfaces/agent';
import type { UniversalMessage } from '../managers/conversation-history-manager';
import type { ToolParameters, ToolExecutionResult, ToolExecutionContext } from '../interfaces/tool';
import type { EventEmitterPlugin, EventType, EventData } from '../plugins/event-emitter-plugin';

/**
 * Plugin categories for classification
 */
export enum PluginCategory {
    /** Monitoring and observability */
    MONITORING = 'monitoring',
    /** Logging and debugging */
    LOGGING = 'logging',
    /** Data storage and persistence */
    STORAGE = 'storage',
    /** External notifications and alerts */
    NOTIFICATION = 'notification',
    /** Security and access control */
    SECURITY = 'security',
    /** Performance optimization */
    PERFORMANCE = 'performance',
    /** Error handling and recovery */
    ERROR_HANDLING = 'error_handling',
    /** Rate limiting and throttling */
    LIMITS = 'limits',
    /** Event processing and coordination */
    EVENT_PROCESSING = 'event_processing',
    /** Custom or specialized functionality */
    CUSTOM = 'custom'
}

/**
 * Plugin priority levels
 */
export enum PluginPriority {
    /** Highest priority - executed first */
    CRITICAL = 1000,
    /** High priority */
    HIGH = 800,
    /** Normal priority (default) */
    NORMAL = 500,
    /** Low priority */
    LOW = 200,
    /** Lowest priority - executed last */
    MINIMAL = 100
}

/**
 * Base execution context for all plugins
 */
export interface BaseExecutionContext {
    executionId?: string;
    sessionId?: string;
    userId?: string;
    // Define specific types for common plugin context data
    messages?: Message[];
    config?: Record<string, string | number | boolean>;
    metadata?: Record<string, string | number | boolean | Date>;
    // Index signature for exactOptionalPropertyTypes compatibility
    [key: string]: string | number | boolean | Date | string[] | number[] | boolean[] | Message[] | Record<string, string | number | boolean> | Record<string, string | number | boolean | Date> | undefined;
}

/**
 * Base execution result for all plugins
 */
export interface BaseExecutionResult {
    response?: string;
    content?: string;
    duration?: number;
    tokensUsed?: number;
    toolsExecuted?: number;
    success?: boolean;
    usage?: { totalTokens?: number; promptTokens?: number; completionTokens?: number };
    // Define specific types for tool call data
    toolCalls?: Array<{
        id?: string;
        name?: string;
        arguments?: Record<string, string | number | boolean>;
        result?: string | number | boolean | null;
    }>;
    // Define specific result types
    results?: Array<{
        id?: string;
        type?: string;
        data?: string | number | boolean | null;
        success?: boolean;
    }>;
    error?: Error;
    // Additional execution metadata
    metadata?: Record<string, string | number | boolean | Date>;
}

/**
 * Error context for plugin error handling
 */
export interface ErrorContext {
    action: string;
    tool?: string;
    parameters?: ToolParameters;
    result?: ToolExecutionResult;
    error?: Error;
    // Define specific types for common error context data
    executionId?: string;
    sessionId?: string;
    userId?: string;
    timestamp?: Date;
    attempt?: number;
    stack?: string;
    metadata?: Record<string, string | number | boolean>;
}

/**
 * Plugin configuration interface
 */
export interface PluginConfig extends BasePluginOptions {
    options?: Record<string, string | number | boolean>;
}

/**
 * Base plugin options that all plugin options should extend
 * This provides a common structure while allowing specific options
 */
export interface BasePluginOptions {
    /** Whether the plugin is enabled */
    enabled?: boolean;
    /** Plugin category for classification */
    category?: PluginCategory;
    /** Plugin priority for execution order */
    priority?: PluginPriority | number;
    /** Events to subscribe to from modules */
    moduleEvents?: EventType[];
    /** Whether to subscribe to all module events */
    subscribeToAllModuleEvents?: boolean;
}

/**
 * Plugin data interface
 */
export interface PluginData {
    name: string;
    version: string;
    enabled: boolean;
    category: PluginCategory;
    priority: number;
    subscribedEvents: EventType[];
    metadata?: Record<string, string | number | boolean>;
}

/**
 * Type-safe plugin interface with specific type parameters
 * 
 * @template TOptions - Plugin options type that extends BasePluginOptions
 * @template TStats - Plugin statistics type (defaults to PluginStats for type safety)
 */
export interface TypeSafePluginInterface<TOptions extends BasePluginOptions = BasePluginOptions, TStats = PluginStats> {
    name: string;
    version: string;
    enabled: boolean;
    category: PluginCategory;
    priority: number;

    initialize(options?: TOptions): Promise<void>;
    cleanup?(): Promise<void>;
    getData?(): PluginData;
    getStats?(): TStats;

    // Event subscription methods
    subscribeToModuleEvents?(eventEmitter: EventEmitterPlugin): Promise<void>;
    unsubscribeFromModuleEvents?(eventEmitter: EventEmitterPlugin): Promise<void>;
    onModuleEvent?(eventType: EventType, eventData: EventData): Promise<void> | void;
}

/**
 * Plugin statistics base interface with common metrics
 */
export interface PluginStats {
    enabled: boolean;
    calls: number;
    errors: number;
    lastActivity?: Date;
    moduleEventsReceived?: number;
    [key: string]: string | number | boolean | Date | undefined;
}

/**
 * Base plugin interface extending TypeSafePluginInterface
 */
export interface BasePluginInterface extends TypeSafePluginInterface<PluginConfig, PluginStats> { }

/**
 * Plugin lifecycle hooks
 */
export interface PluginHooks {
    /**
     * Called before agent run
     */
    beforeRun?(input: string, options?: RunOptions): Promise<void> | void;

    /**
     * Called after agent run
     */
    afterRun?(input: string, response: string, options?: RunOptions): Promise<void> | void;

    /**
     * Called before execution with context
     */
    beforeExecution?(context: BaseExecutionContext): Promise<void> | void;

    /**
     * Called after execution with context and result
     */
    afterExecution?(context: BaseExecutionContext, result: BaseExecutionResult): Promise<void> | void;

    /**
     * Called before conversation with context
     */
    beforeConversation?(context: BaseExecutionContext): Promise<void> | void;

    /**
     * Called after conversation with context and result
     */
    afterConversation?(context: BaseExecutionContext, result: BaseExecutionResult): Promise<void> | void;

    /**
     * Called before tool execution
     */
    beforeToolCall?(toolName: string, parameters: ToolParameters): Promise<void> | void;

    /**
     * Called before tool execution with context
     */
    beforeToolExecution?(context: BaseExecutionContext, toolData: ToolExecutionContext): Promise<void> | void;

    /**
     * Called after tool execution
     */
    afterToolCall?(toolName: string, parameters: ToolParameters, result: ToolExecutionResult): Promise<void> | void;

    /**
     * Called after tool execution with context
     */
    afterToolExecution?(context: BaseExecutionContext, toolResults: BaseExecutionResult): Promise<void> | void;

    /**
     * Called before AI provider call
     */
    beforeProviderCall?(messages: UniversalMessage[]): Promise<void> | void;

    /**
     * Called after AI provider call
     */
    afterProviderCall?(messages: UniversalMessage[], response: UniversalMessage): Promise<void> | void;

    /**
     * Called on streaming chunk
     */
    onStreamingChunk?(chunk: UniversalMessage): Promise<void> | void;

    /**
     * Called on error
     */
    onError?(error: Error, context?: ErrorContext): Promise<void> | void;

    /**
     * Called on message added to history
     */
    onMessageAdded?(message: Message): Promise<void> | void;

    /**
     * Called when module events are received
     */
    onModuleEvent?(eventType: EventType, eventData: EventData): Promise<void> | void;
}

/**
 * Base abstract class for all plugins with type parameter support
 * Provides plugin lifecycle management and common functionality
 * 
 * Enhanced with:
 * - Plugin classification system (categories and priorities)
 * - EventEmitter integration for module event subscription
 * - Improved statistics tracking
 * - Better error handling and recovery
 * 
 * @template TOptions - Plugin options type that extends BasePluginOptions
 * @template TStats - Plugin statistics type (defaults to PluginStats for type safety)
 */
export abstract class BasePlugin<TOptions extends BasePluginOptions = BasePluginOptions, TStats = PluginStats>
    implements TypeSafePluginInterface<TOptions, TStats>, PluginHooks {
    /** Plugin name */
    abstract readonly name: string;

    /** Plugin version */
    abstract readonly version: string;

    /** Plugin enabled state */
    public enabled = true;

    /** Plugin category for classification */
    public category: PluginCategory = PluginCategory.CUSTOM;

    /** Plugin priority for execution order */
    public priority: number = PluginPriority.NORMAL;

    /** Plugin options */
    protected options: TOptions | undefined;

    /** EventEmitter for module event subscription */
    protected eventEmitter: EventEmitterPlugin | undefined;

    /** Subscribed event types */
    protected subscribedEvents: EventType[] = [];

    /** Event subscription handlers */
    protected eventHandlers = new Map<EventType, string>();

    /** Plugin statistics */
    protected stats = {
        calls: 0,
        errors: 0,
        moduleEventsReceived: 0,
        lastActivity: undefined as Date | undefined
    };

    /**
     * Initialize the plugin with type-safe options
     */
    async initialize(options?: TOptions): Promise<void> {
        this.options = options;

        // Set enabled state from options with default fallback
        if (options && 'enabled' in options && typeof options.enabled === 'boolean') {
            this.enabled = options.enabled;
        } else {
            this.enabled = true; // Default to enabled
        }

        // Set category from options
        if (options?.category) {
            this.category = options.category;
        }

        // Set priority from options
        if (options?.priority !== undefined) {
            this.priority = typeof options.priority === 'number'
                ? options.priority
                : options.priority;
        }

        // Default implementation - can be overridden
    }

    /**
     * Subscribe to module events through EventEmitter
     */
    async subscribeToModuleEvents(eventEmitter: EventEmitterPlugin): Promise<void> {
        this.eventEmitter = eventEmitter;

        if (!this.options) {
            return;
        }

        const eventsToSubscribe: EventType[] = [];

        // Subscribe to all module events if requested
        if (this.options.subscribeToAllModuleEvents) {
            eventsToSubscribe.push(
                'module.initialize.start',
                'module.initialize.complete',
                'module.initialize.error',
                'module.execution.start',
                'module.execution.complete',
                'module.execution.error',
                'module.dispose.start',
                'module.dispose.complete',
                'module.dispose.error'
            );
        }

        // Subscribe to specific events if specified
        if (this.options.moduleEvents) {
            eventsToSubscribe.push(...this.options.moduleEvents);
        }

        // Remove duplicates
        const uniqueEvents = [...new Set(eventsToSubscribe)];

        // Subscribe to events
        for (const eventType of uniqueEvents) {
            const handlerId = this.eventEmitter.on(eventType, async (eventData: EventData) => {
                try {
                    this.stats.moduleEventsReceived++;
                    this.stats.lastActivity = new Date();

                    await this.onModuleEvent?.(eventType, eventData);
                } catch (error) {
                    this.stats.errors++;
                    // Log error but don't throw to avoid breaking event processing
                    // Plugin failed to handle module event
                }
            });

            this.eventHandlers.set(eventType, handlerId);
            this.subscribedEvents.push(eventType);
        }

        if (uniqueEvents.length > 0) {
            // Plugin subscribed to module events
        }
    }

    /**
     * Unsubscribe from module events
     */
    async unsubscribeFromModuleEvents(eventEmitter: EventEmitterPlugin): Promise<void> {
        for (const [eventType, handlerId] of this.eventHandlers.entries()) {
            eventEmitter.off(eventType, handlerId);
        }

        this.eventHandlers.clear();
        this.subscribedEvents = [];
        this.eventEmitter = undefined;

        // Plugin unsubscribed from all module events
    }

    /**
     * Cleanup plugin resources
     */
    async dispose(): Promise<void> {
        // Unsubscribe from events if subscribed
        if (this.eventEmitter) {
            await this.unsubscribeFromModuleEvents(this.eventEmitter);
        }

        // Default implementation - can be overridden
    }

    /**
     * Enable the plugin
     */
    enable(): void {
        this.enabled = true;
    }

    /**
     * Disable the plugin
     */
    disable(): void {
        this.enabled = false;
    }

    /**
     * Check if plugin is enabled
     */
    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Get plugin configuration
     */
    getConfig(): PluginConfig {
        return {};
    }

    /**
     * Update plugin configuration
     */
    updateConfig(_config: PluginConfig): void {
        // Default implementation - can be overridden
    }

    /**
     * Get plugin data - enhanced with classification information
     */
    getData(): PluginData {
        return {
            name: this.name,
            version: this.version,
            enabled: this.enabled,
            category: this.category,
            priority: this.priority,
            subscribedEvents: [...this.subscribedEvents],
            metadata: {
                moduleEventsReceived: this.stats.moduleEventsReceived,
                totalCalls: this.stats.calls,
                totalErrors: this.stats.errors
            }
        };
    }

    /**
     * Clear plugin data - common interface for all plugins
     * This method should be implemented by plugins that store data
     */
    clearData?(): void;

    /**
     * Get plugin status - enhanced with classification information
     */
    getStatus(): {
        name: string;
        version: string;
        enabled: boolean;
        initialized: boolean;
        category: PluginCategory;
        priority: number;
        subscribedEventsCount: number;
        hasEventEmitter: boolean;
    } {
        return {
            name: this.name,
            version: this.version,
            enabled: this.enabled,
            initialized: true, // Can be overridden by plugins to track initialization state
            category: this.category,
            priority: this.priority,
            subscribedEventsCount: this.subscribedEvents.length,
            hasEventEmitter: !!this.eventEmitter
        };
    }

    /**
     * Get plugin statistics - enhanced with module event tracking
     */
    getStats(): TStats {
        const baseStats: PluginStats = {
            enabled: this.enabled,
            calls: this.stats.calls,
            errors: this.stats.errors,
            moduleEventsReceived: this.stats.moduleEventsReceived,
            ...(this.stats.lastActivity && { lastActivity: this.stats.lastActivity })
        };

        return baseStats as TStats;
    }

    /**
     * Update plugin call statistics
     */
    protected updateCallStats(): void {
        this.stats.calls++;
        this.stats.lastActivity = new Date();
    }

    /**
     * Update plugin error statistics
     */
    protected updateErrorStats(): void {
        this.stats.errors++;
        this.stats.lastActivity = new Date();
    }

    // Optional lifecycle hooks - plugins can override these
    async beforeRun?(input: string, options?: RunOptions): Promise<void>;
    async afterRun?(input: string, response: string, options?: RunOptions): Promise<void>;
    async beforeExecution?(context: BaseExecutionContext): Promise<void>;
    async afterExecution?(context: BaseExecutionContext, result: BaseExecutionResult): Promise<void>;
    async beforeConversation?(context: BaseExecutionContext): Promise<void>;
    async afterConversation?(context: BaseExecutionContext, result: BaseExecutionResult): Promise<void>;
    async beforeToolCall?(toolName: string, parameters: ToolParameters): Promise<void>;
    async beforeToolExecution?(context: BaseExecutionContext, toolData: ToolExecutionContext): Promise<void>;
    async afterToolCall?(toolName: string, parameters: ToolParameters, result: ToolExecutionResult): Promise<void>;
    async afterToolExecution?(context: BaseExecutionContext, toolResults: BaseExecutionResult): Promise<void>;
    async beforeProviderCall?(messages: UniversalMessage[]): Promise<void>;
    async afterProviderCall?(messages: UniversalMessage[], response: UniversalMessage): Promise<void>;
    async onStreamingChunk?(chunk: UniversalMessage): Promise<void>;
    async onError?(error: Error, context?: ErrorContext): Promise<void>;
    async onMessageAdded?(message: Message): Promise<void>;
    async onModuleEvent?(eventType: EventType, eventData: EventData): Promise<void>;
} 
import type { Message, RunOptions } from '../interfaces/agent';
import type { UniversalMessage } from '../managers/conversation-history-manager';
import type { ToolParameters, ToolExecutionResult, ToolExecutionContext } from '../interfaces/tool';

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
export interface PluginConfig {
    enabled?: boolean;
    options?: Record<string, string | number | boolean>;
}

/**
 * Plugin data interface
 */
export interface PluginData {
    name: string;
    version: string;
    enabled: boolean;
    metadata?: Record<string, string | number | boolean>;
}

/**
 * Type-safe plugin interface with type parameters
 * 
 * @template TOptions - Plugin options type
 * @template TContext - Plugin context type  
 * @template TStats - Plugin statistics type
 */
export interface TypeSafePluginInterface<TOptions = Record<string, unknown>, TStats = Record<string, unknown>> {
    name: string;
    version: string;
    enabled: boolean;

    initialize(options?: TOptions): Promise<void>;
    cleanup?(): Promise<void>;
    getData?(): PluginData;
    getStats?(): TStats;
}

/**
 * Base plugin interface (legacy)
 * @deprecated Use TypeSafePluginInterface instead
 */
export interface BasePluginInterface extends TypeSafePluginInterface<PluginConfig, Record<string, unknown>> { }

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
}

/**
 * Base abstract class for all plugins with type parameter support
 * Provides plugin lifecycle management and common functionality
 * 
 * @template TOptions - Plugin options type (defaults to PluginConfig for backward compatibility)
 * @template TContext - Plugin context type (defaults to BaseExecutionContext for backward compatibility)
 * @template TStats - Plugin statistics type (defaults to Record<string, unknown> for backward compatibility)
 */
export abstract class BasePlugin<TOptions = PluginConfig, TStats = Record<string, unknown>>
    implements TypeSafePluginInterface<TOptions, TStats>, PluginHooks {
    /** Plugin name */
    abstract readonly name: string;

    /** Plugin version */
    abstract readonly version: string;

    /** Plugin enabled state */
    public enabled = true;

    /** Plugin options */
    protected options: TOptions | undefined;

    /**
     * Initialize the plugin with type-safe options
     */
    async initialize(options?: TOptions): Promise<void> {
        this.options = options;
        // Default implementation - can be overridden
    }

    /**
     * Cleanup plugin resources
     */
    async dispose(): Promise<void> {
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
     * Get plugin data - common interface for all plugins
     * This method should be implemented by plugins that collect data
     */
    getData?(): PluginData;



    /**
     * Clear plugin data - common interface for all plugins
     * This method should be implemented by plugins that store data
     */
    clearData?(): void;

    /**
     * Get plugin status - common interface for all plugins
     */
    getStatus(): {
        name: string;
        version: string;
        enabled: boolean;
        initialized: boolean;
    } {
        return {
            name: this.name,
            version: this.version,
            enabled: this.enabled,
            initialized: true // Can be overridden by plugins to track initialization state
        };
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
} 
import type { Message, RunOptions } from '../interfaces/agent';
import type { UniversalMessage } from '../managers/conversation-history-manager';
import type { ToolParameters, ToolExecutionResult } from '../interfaces/tool';

/**
 * Error context for plugin error handling
 */
export interface ErrorContext {
    action: string;
    tool?: string;
    parameters?: ToolParameters;
    result?: ToolExecutionResult;
    error?: Error;
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
 * Base plugin interface
 */
export interface BasePluginInterface {
    name: string;
    version: string;
    enabled: boolean;

    initialize(config?: PluginConfig): Promise<void>;
    beforeExecution?(tool: string, parameters: ToolParameters): Promise<void>;
    afterExecution?(tool: string, result: ToolExecutionResult): Promise<void>;
    onError?(error: Error, context: ErrorContext): Promise<void>;
    cleanup?(): Promise<void>;
    getData?(): PluginData;
}

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
     * Called before tool execution
     */
    beforeToolCall?(toolName: string, parameters: ToolParameters): Promise<void> | void;

    /**
     * Called after tool execution
     */
    afterToolCall?(toolName: string, parameters: ToolParameters, result: ToolExecutionResult): Promise<void> | void;

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
 * Base abstract class for all plugins
 * Provides plugin lifecycle management and common functionality
 */
export abstract class BasePlugin implements PluginHooks {
    /** Plugin name */
    abstract readonly name: string;

    /** Plugin version */
    abstract readonly version: string;

    /** Plugin enabled state */
    protected enabled = true;

    /**
     * Initialize the plugin
     */
    async initialize(): Promise<void> {
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
    async beforeToolCall?(toolName: string, parameters: ToolParameters): Promise<void>;
    async afterToolCall?(toolName: string, parameters: ToolParameters, result: ToolExecutionResult): Promise<void>;
    async beforeProviderCall?(messages: UniversalMessage[]): Promise<void>;
    async afterProviderCall?(messages: UniversalMessage[], response: UniversalMessage): Promise<void>;
    async onStreamingChunk?(chunk: UniversalMessage): Promise<void>;
    async onError?(error: Error, context?: ErrorContext): Promise<void>;
    async onMessageAdded?(message: Message): Promise<void>;
} 
import type { Message, RunOptions } from '../interfaces/agent';
import type { Context, ModelResponse, StreamingResponseChunk } from '../interfaces/provider';

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
    beforeToolCall?(toolName: string, parameters: Record<string, any>): Promise<void> | void;

    /**
     * Called after tool execution
     */
    afterToolCall?(toolName: string, parameters: Record<string, any>, result: any): Promise<void> | void;

    /**
     * Called before AI provider call
     */
    beforeProviderCall?(context: Context): Promise<void> | void;

    /**
     * Called after AI provider call
     */
    afterProviderCall?(context: Context, response: ModelResponse): Promise<void> | void;

    /**
     * Called on streaming chunk
     */
    onStreamingChunk?(chunk: StreamingResponseChunk): Promise<void> | void;

    /**
     * Called on error
     */
    onError?(error: Error, context?: any): Promise<void> | void;

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
    getConfig(): Record<string, any> {
        return {};
    }

    /**
     * Update plugin configuration
     */
    updateConfig(_config: Record<string, any>): void {
        // Default implementation - can be overridden
    }

    /**
     * Get plugin data - common interface for all plugins
     * This method should be implemented by plugins that collect data
     */
    getData?(): any;

    /**
     * Get plugin statistics - common interface for all plugins
     * This method should be implemented by plugins that track statistics
     */
    getStats?(): any;

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
    async beforeToolCall?(toolName: string, parameters: Record<string, any>): Promise<void>;
    async afterToolCall?(toolName: string, parameters: Record<string, any>, result: any): Promise<void>;
    async beforeProviderCall?(context: Context): Promise<void>;
    async afterProviderCall?(context: Context, response: ModelResponse): Promise<void>;
    async onStreamingChunk?(chunk: StreamingResponseChunk): Promise<void>;
    async onError?(error: Error, context?: any): Promise<void>;
    async onMessageAdded?(message: Message): Promise<void>;
} 
import type { IAIProvider, IToolSchema } from './provider';
import type { IToolInterface, TToolExecutor, IToolExecutionContext } from './tool';
import type { TToolResultData } from './types';
import type { IAgentConfig, IAgent } from './agent';

/**
 * Reusable type definitions for manager layer
 */

/**
 * Agent creation metadata type
 * Used for storing additional information about agent creation and configuration
 */
export type TAgentCreationMetadata = Record<string, string | number | boolean | Date>;

/**
 * Tool execution parameters for manager operations
 * Used for tool parameter validation and execution in manager context
 */
export type TManagerToolParameters = Record<string, string | number | boolean | string[] | number[] | boolean[]>;

/**
 * Configuration validation result
 */
export interface IConfigValidationResult {
    isValid: boolean;
    errors: string[];
    warnings?: string[];
}

/**
 * AI Provider Manager interface for provider registration and selection
 */
export interface IAIProviderManager {
    /**
     * Register an AI provider
     */
    addProvider(name: string, provider: IAIProvider): void;

    /**
     * Remove an AI provider
     */
    removeProvider(name: string): void;

    /**
     * Get registered provider by name
     */
    getProvider(name: string): IAIProvider | undefined;

    /**
     * Get all registered providers
     */
    getProviders(): Record<string, IAIProvider>;

    /**
     * Set current provider and model
     */
    setCurrentProvider(name: string, model: string): void;

    /**
     * Get current provider and model
     */
    getCurrentProvider(): { provider: string; model: string } | undefined;

    /**
     * Check if provider is configured
     */
    isConfigured(): boolean;

    /**
     * Get available models for a provider
     */
    getAvailableModels(providerName: string): string[];
}

/**
 * Tool Manager interface for tool registration and management
 */
export interface IToolManager {
    /**
     * Register a tool
     */
    addTool(schema: IToolSchema, executor: TToolExecutor): void;

    /**
     * Remove a tool by name
     */
    removeTool(name: string): void;

    /**
     * Get tool interface by name
     */
    getTool(name: string): IToolInterface | undefined;

    /**
     * Get tool schema by name
     */
    getToolSchema(name: string): IToolSchema | undefined;

    /**
     * Get all registered tools
     */
    getTools(): IToolSchema[];

    /**
     * Execute a tool
     */
    executeTool(name: string, parameters: TManagerToolParameters, context?: IToolExecutionContext): Promise<TToolResultData>;

    /**
     * Check if tool exists
     */
    hasTool(name: string): boolean;

    /**
     * Set allowed tools (for filtering)
     */
    setAllowedTools(tools: string[]): void;

    /**
     * Get allowed tools
     */
    getAllowedTools(): string[] | undefined;
}

/**
 * Agent creation options
 */
export interface IAgentCreationOptions {
    /** Override default configuration */
    overrides?: Partial<IAgentConfig>;
    /** Validation options */
    validation?: {
        strict?: boolean;
        skipOptional?: boolean;
    };
    /** Additional metadata */
    metadata?: TAgentCreationMetadata;
}

/**
 * Agent Factory interface for agent creation and configuration
 */
export interface IAgentFactory {
    /**
     * Create agent instance
     */
    createAgent(config: IAgentConfig, options?: IAgentCreationOptions): IAgent<IAgentConfig>;

    /**
     * Validate agent configuration
     */
    validateConfig(config: IAgentConfig): IConfigValidationResult;

    /**
     * Get default configuration
     */
    getDefaultConfig(): IAgentConfig;

    /**
     * Merge configurations
     */
    mergeConfig(base: IAgentConfig, override: Partial<IAgentConfig>): IAgentConfig;
} 
import type { AIProvider } from './provider';
import type { ToolSchema } from './provider';
import type { ToolInterface, ToolExecutor, ToolExecutionData } from './tool';
import type { AgentConfig, AgentInterface } from './agent';

/**
 * Reusable type definitions for manager layer
 */

/**
 * Agent creation metadata type
 * Used for storing additional information about agent creation and configuration
 */
export type AgentCreationMetadata = Record<string, string | number | boolean | Date>;

/**
 * Tool execution parameters for manager operations
 * Used for tool parameter validation and execution in manager context
 */
export type ManagerToolParameters = Record<string, string | number | boolean | string[] | number[] | boolean[]>;

/**
 * Configuration validation result
 */
export interface ConfigValidationResult {
    isValid: boolean;
    errors: string[];
    warnings?: string[];
}

/**
 * AI Provider Manager interface for provider registration and selection
 */
export interface AIProviderManagerInterface {
    /**
     * Register an AI provider
     */
    addProvider(name: string, provider: AIProvider): void;

    /**
     * Remove an AI provider
     */
    removeProvider(name: string): void;

    /**
     * Get registered provider by name
     */
    getProvider(name: string): AIProvider | undefined;

    /**
     * Get all registered providers
     */
    getProviders(): Record<string, AIProvider>;

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
export interface ToolManagerInterface {
    /**
     * Register a tool
     */
    addTool(schema: ToolSchema, executor: ToolExecutor): void;

    /**
     * Remove a tool by name
     */
    removeTool(name: string): void;

    /**
     * Get tool interface by name
     */
    getTool(name: string): ToolInterface | undefined;

    /**
     * Get tool schema by name
     */
    getToolSchema(name: string): ToolSchema | undefined;

    /**
     * Get all registered tools
     */
    getTools(): ToolSchema[];

    /**
     * Execute a tool
     */
    executeTool(name: string, parameters: ManagerToolParameters): Promise<ToolExecutionData>;

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
export interface AgentCreationOptions {
    /** Override default configuration */
    overrides?: Partial<AgentConfig>;
    /** Validation options */
    validation?: {
        strict?: boolean;
        skipOptional?: boolean;
    };
    /** Additional metadata */
    metadata?: AgentCreationMetadata;
}

/**
 * Agent Factory interface for agent creation and configuration
 */
export interface AgentFactoryInterface {
    /**
     * Create agent instance
     */
    createAgent(config: AgentConfig, options?: AgentCreationOptions): AgentInterface;

    /**
     * Validate agent configuration
     */
    validateConfig(config: AgentConfig): ConfigValidationResult;

    /**
     * Get default configuration
     */
    getDefaultConfig(): AgentConfig;

    /**
     * Merge configurations
     */
    mergeConfig(base: AgentConfig, override: Partial<AgentConfig>): AgentConfig;
} 
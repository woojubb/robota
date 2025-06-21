import type { AIProvider } from './provider';
import type { ToolSchema } from './provider';
import type { ToolInterface } from './tool';

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
    addTool(schema: ToolSchema, executor: (...args: any[]) => Promise<any>): void;

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
    executeTool(name: string, parameters: Record<string, any>): Promise<any>;

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
 * Agent Factory interface for agent creation and configuration
 */
export interface AgentFactoryInterface {
    /**
     * Create agent instance
     */
    createAgent(config: any): any;

    /**
     * Validate agent configuration
     */
    validateConfig(config: any): boolean;

    /**
     * Get default configuration
     */
    getDefaultConfig(): any;

    /**
     * Merge configurations
     */
    mergeConfig(base: any, override: any): any;
} 
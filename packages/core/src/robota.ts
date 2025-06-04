import type {
    RunOptions
} from './types';
import type { AIProvider, Message, ModelResponse, StreamingResponseChunk } from './interfaces/ai-provider';
import type { Logger } from './interfaces/logger';
import type { ConversationHistory } from './conversation-history';
import type { ToolProvider } from '@robota-sdk/tools';

import { SimpleConversationHistory } from './conversation-history';
import { AIProviderManager } from './managers/ai-provider-manager';
import { ToolProviderManager } from './managers/tool-provider-manager';
import { SystemMessageManager } from './managers/system-message-manager';
import { FunctionCallManager, type FunctionCallConfig, type FunctionCallMode } from './managers/function-call-manager';
import { AnalyticsManager } from './managers/analytics-manager';
import { RequestLimitManager } from './managers/request-limit-manager';
import { TokenAnalyzer } from './analyzers/token-analyzer';
import { ConversationService } from './services/conversation-service';
import { ExecutionService } from './services/execution-service';
import { RobotaConfigManager, type RobotaConfigInput } from './managers/robota-config-manager';

// Import operations
import {
    aiProviderOps,
    systemMessageOps,
    functionCallOps,
    analyticsOps,
    toolOps,
    conversationOps
} from './operations';

/**
 * Configuration options for initializing Robota instance
 * 
 * @public
 * @interface RobotaOptions
 */
export interface RobotaOptions {
    /** 
     * Tool providers that supply tools like MCP, OpenAPI, ZodFunction, etc.
     * 
     * @see {@link ../../../apps/examples/02-functions | Function Examples}
     */
    toolProviders?: ToolProvider[];

    /** 
     * AI providers - Register multiple AI providers by name
     * 
     * @see {@link ../../../apps/examples/03-integrations | Provider Integration Examples}
     */
    aiProviders?: Record<string, AIProvider>;

    /** 
     * Current AI provider name to use from registered providers
     * Must match a key in aiProviders
     */
    currentProvider?: string;

    /** 
     * Current model name to use with the selected provider
     */
    currentModel?: string;

    /** 
     * Model temperature for response generation (0.0 to 2.0)
     * Lower values make responses more focused and deterministic
     * 
     * @defaultValue undefined (uses provider default)
     */
    temperature?: number;

    /** 
     * Maximum number of tokens for generated responses
     * 
     * @defaultValue undefined (uses provider default)
     */
    maxTokens?: number;

    /** 
     * System prompt to set context for AI responses
     * Will be converted to a system message
     */
    systemPrompt?: string;

    /** 
     * Array of system messages for more complex system configuration
     * Use this instead of systemPrompt for multiple system messages
     */
    systemMessages?: Message[];

    /** 
     * Custom conversation history implementation
     * 
     * @defaultValue SimpleConversationHistory instance
     */
    conversationHistory?: ConversationHistory;

    /** 
     * Configuration for function/tool calling behavior
     */
    functionCallConfig?: FunctionCallConfig;

    /** 
     * Callback function executed when a tool is called
     * Useful for monitoring, logging, or custom handling
     * 
     * @param toolName - Name of the called tool
     * @param params - Parameters passed to the tool
     * @param result - Result returned by the tool
     */
    onToolCall?: (toolName: string, params: any, result: any) => void;

    /** 
     * Custom logger implementation
     * 
     * @defaultValue console
     */
    logger?: Logger;

    /** 
     * Enable debug mode for detailed logging
     * 
     * @defaultValue false
     */
    debug?: boolean;

    /** 
     * Maximum token limit across all requests (0 = unlimited)
     * Used for budget control and preventing excessive usage
     * 
     * @defaultValue 4096
     */
    maxTokenLimit?: number;

    /** 
     * Maximum request limit (0 = unlimited)
     * Used for rate limiting and controlling API usage
     * 
     * @defaultValue 25
     */
    maxRequestLimit?: number;
}

/**
 * Main Robota class for AI agent interaction
 * 
 * Provides a high-level interface for AI conversations with support for:
 * - Multiple AI providers (OpenAI, Anthropic, Google, etc.)
 * - Tool/function calling
 * - Conversation history management
 * - Request limiting and analytics
 * - Streaming responses
 * 
 * @see {@link ../../../apps/examples/01-basic | Basic Usage Examples}
 * @see {@link ../../../apps/examples/05-advanced | Advanced Configuration Examples}
 * 
 * @public
 */
export class Robota {
    /** @internal Configuration manager handling all settings */
    private readonly configManager: RobotaConfigManager;

    /** @internal Service handling execution logic */
    private readonly executionService: ExecutionService;

    /** @internal AI provider management */
    private readonly aiProviderManager: AIProviderManager;

    /** @internal Tool provider management */
    private readonly toolProviderManager: ToolProviderManager;

    /** @internal System message management */
    private readonly systemMessageManager: SystemMessageManager;

    /** @internal Function call management */
    private readonly functionCallManager: FunctionCallManager;

    /** @internal Analytics and metrics collection */
    private readonly analyticsManager: AnalyticsManager;

    /** @internal Request and token limit enforcement */
    private readonly requestLimitManager: RequestLimitManager;

    /** @internal Token analysis utilities */
    private readonly tokenAnalyzer: TokenAnalyzer;

    /** @internal Conversation service for high-level operations */
    private readonly conversationService: ConversationService;

    /** @internal Conversation history storage */
    private readonly conversationHistory: ConversationHistory;

    /** @internal Optional tool call callback */
    private readonly onToolCall?: (toolName: string, params: any, result: any) => void;

    /** @internal Logger instance */
    private readonly logger: Logger;

    /** @internal Debug mode flag */
    private readonly debug: boolean;

    /**
     * Create a new Robota instance
     * 
     * @param options - Configuration options for the instance
     */
    constructor(options: RobotaOptions) {
        // Initialize configuration with defaults
        const config = new RobotaConfigManager({
            aiProviders: options.aiProviders || {},
            currentProvider: options.currentProvider,
            currentModel: options.currentModel,
            temperature: options.temperature,
            maxTokens: options.maxTokens,
            systemPrompt: options.systemPrompt,
            systemMessages: options.systemMessages,
            toolProviders: options.toolProviders || [],
            functionCallConfig: options.functionCallConfig,
            maxTokenLimit: options.maxTokenLimit || 4096,
            maxRequestLimit: options.maxRequestLimit || 25
        });

        this.configManager = config;
        this.debug = options.debug || false;
        this.logger = options.logger || console;
        this.onToolCall = options.onToolCall;

        // Initialize core managers
        this.aiProviderManager = new AIProviderManager();
        this.toolProviderManager = new ToolProviderManager(this.logger);
        this.systemMessageManager = new SystemMessageManager();
        this.functionCallManager = new FunctionCallManager(options.functionCallConfig);
        this.analyticsManager = new AnalyticsManager();
        this.requestLimitManager = new RequestLimitManager(
            config.getConfiguration().maxTokenLimit,
            config.getConfiguration().maxRequestLimit
        );
        this.tokenAnalyzer = new TokenAnalyzer();

        // Initialize conversation history
        this.conversationHistory = options.conversationHistory || new SimpleConversationHistory();

        // Initialize services with dependencies
        this.conversationService = new ConversationService(
            options.temperature,
            options.maxTokens,
            this.logger,
            this.debug
        );

        this.executionService = new ExecutionService(
            this.aiProviderManager,
            this.toolProviderManager,
            this.requestLimitManager,
            this.analyticsManager,
            this.tokenAnalyzer,
            this.conversationService,
            this.logger,
            this.debug,
            this.onToolCall
        );

        // Apply configuration using operations
        this.applyConfiguration(config.getConfiguration());
    }

    /**
     * Apply configuration using pure functions
     * @internal
     */
    private applyConfiguration(config: any): void {
        // Apply AI provider configuration
        aiProviderOps.applyAIProviderConfiguration(config, this.aiProviderManager);

        // Register Tool Providers
        if (config.toolProviders.length > 0) {
            this.toolProviderManager.addProviders(config.toolProviders);
        }

        // Apply system message configuration
        systemMessageOps.applySystemMessageConfiguration(config, this.systemMessageManager);
    }

    // ============================================================
    // AI Provider Management - High-level API
    // ============================================================

    /**
     * Add an AI provider to the available providers
     * 
     * @param name - Unique name for the provider
     * @param aiProvider - AI provider implementation
     * 
     * @see {@link ../../../apps/examples/01-basic/03-multi-ai-providers.ts | Multi-Provider Example}
     */
    addAIProvider(name: string, aiProvider: AIProvider): void {
        aiProviderOps.addAIProvider(name, aiProvider, this.aiProviderManager, this.configManager);
    }

    /**
     * Set the current AI provider and model to use for requests
     * 
     * @param providerName - Name of the registered provider
     * @param model - Model name to use with the provider
     * 
     * @throws {Error} When provider is not registered
     */
    setCurrentAI(providerName: string, model: string): void {
        aiProviderOps.setCurrentAI(providerName, model, this.aiProviderManager, this.configManager);
    }

    /**
     * Get the currently configured AI provider and model
     * 
     * @returns Object containing current provider and model names
     */
    getCurrentAI(): { provider?: string; model?: string } {
        return aiProviderOps.getCurrentAI(this.aiProviderManager);
    }

    // ============================================================
    // System Message Management - High-level API
    // ============================================================

    /**
     * Set a single system prompt that defines the AI's behavior
     * 
     * @param prompt - System prompt text
     * 
     * @see {@link ../../../apps/examples/05-advanced/01-system-message-management.ts | System Message Examples}
     */
    setSystemPrompt(prompt: string): void {
        systemMessageOps.setSystemPrompt(prompt, this.systemMessageManager, this.configManager);
    }

    /**
     * Set multiple system messages for complex system configuration
     * 
     * @param messages - Array of system messages
     * 
     * @see {@link ../../../apps/examples/05-advanced/01-system-message-management.ts | System Message Examples}
     */
    setSystemMessages(messages: Message[]): void {
        systemMessageOps.setSystemMessages(messages, this.systemMessageManager);
    }

    /**
     * Add a single system message to existing system messages
     * 
     * @param content - Content of the system message to add
     */
    addSystemMessage(content: string): void {
        systemMessageOps.addSystemMessage(content, this.systemMessageManager);
    }

    // ============================================================
    // Function Call Management - High-level API
    // ============================================================

    /**
     * Set the function call mode for tool usage
     * 
     * @param mode - Function call mode ('auto', 'none', 'required', or specific function)
     */
    setFunctionCallMode(mode: FunctionCallMode): void {
        functionCallOps.setFunctionCallMode(mode, this.functionCallManager);
    }

    /**
     * Configure function call settings comprehensively
     * 
     * @param config - Function call configuration object
     */
    configureFunctionCall(config: {
        /** Function call mode */
        mode?: FunctionCallMode;
        /** Maximum number of function calls per request */
        maxCalls?: number;
        /** Timeout for function calls in milliseconds */
        timeout?: number;
        /** List of allowed function names (null = all allowed) */
        allowedFunctions?: string[];
    }): void {
        functionCallOps.configureFunctionCall(config, this.functionCallManager, this.toolProviderManager);
    }

    // ============================================================
    // Request Limit Management - High-level API
    // ============================================================

    /**
     * Set maximum token limit across all requests (0 = unlimited)
     * 
     * @param limit - Maximum number of tokens (0 for unlimited)
     * 
     * @see {@link ../../../apps/examples/05-advanced/02-analytics-and-limits.ts | Analytics Examples}
     */
    setMaxTokenLimit(limit: number): void {
        analyticsOps.setMaxTokenLimit(limit, this.requestLimitManager);
    }

    /**
     * Set maximum request limit (0 = unlimited)
     * 
     * @param limit - Maximum number of requests (0 for unlimited)
     * 
     * @see {@link ../../../apps/examples/05-advanced/02-analytics-and-limits.ts | Analytics Examples}
     */
    setMaxRequestLimit(limit: number): void {
        analyticsOps.setMaxRequestLimit(limit, this.requestLimitManager);
    }

    /**
     * Get current maximum token limit
     * 
     * @returns Maximum token limit (0 = unlimited)
     */
    getMaxTokenLimit(): number {
        return analyticsOps.getMaxTokenLimit(this.requestLimitManager);
    }

    /**
     * Get current maximum request limit
     * 
     * @returns Maximum request limit (0 = unlimited)
     */
    getMaxRequestLimit(): number {
        return analyticsOps.getMaxRequestLimit(this.requestLimitManager);
    }

    /**
     * Get comprehensive limit and usage information
     * 
     * @returns Object containing request and token limits with current usage
     * 
     * @see {@link ../../../apps/examples/05-advanced/02-analytics-and-limits.ts | Analytics Examples}
     */
    getLimitInfo() {
        return analyticsOps.getLimitInfo(this.requestLimitManager);
    }

    /**
     * Get current request count
     * 
     * @returns Number of requests made so far
     */
    getRequestCount(): number {
        return analyticsOps.getRequestCount(this.requestLimitManager);
    }

    /**
     * Get total tokens used across all requests
     * 
     * @returns Total number of tokens consumed
     */
    getTotalTokensUsed(): number {
        return analyticsOps.getTotalTokensUsed(this.requestLimitManager);
    }

    // ============================================================
    // Analytics - High-level API
    // ============================================================

    /**
     * Get comprehensive analytics data
     * 
     * @returns Analytics object with usage metrics and trends
     * 
     * @see {@link ../../../apps/examples/05-advanced/02-analytics-and-limits.ts | Analytics Examples}
     */
    getAnalytics() {
        return analyticsOps.getAnalytics(this.analyticsManager);
    }

    /**
     * Reset all analytics and usage counters
     * 
     * Clears conversation history, resets token/request counters,
     * and removes all analytics data. Useful for starting fresh.
     */
    resetAnalytics(): void {
        analyticsOps.resetAnalytics(this.analyticsManager, this.requestLimitManager);
    }

    /**
     * Get token usage analytics for a specific time period
     * 
     * @param startDate - Start date for the period
     * @param endDate - End date for the period (defaults to now)
     * @returns Token usage data for the specified period
     * 
     * @see {@link ../../../apps/examples/05-advanced/02-analytics-and-limits.ts | Analytics Examples}
     */
    getTokenUsageByPeriod(startDate: Date, endDate?: Date) {
        return analyticsOps.getTokenUsageByPeriod(startDate, endDate, this.analyticsManager);
    }

    // ============================================================
    // Core Execution Methods
    // ============================================================

    /**
     * Execute AI conversation with prompt
     * 
     * Core method for running AI conversations. Handles context building,
     * tool calling, and response processing automatically.
     * 
     * @param prompt - User input text
     * @param options - Optional run configuration
     * @returns Promise resolving to AI response text
     * 
     * @throws {Error} When limits exceeded or execution fails
     * 
     * @see {@link ../../../apps/examples/01-basic | Basic Usage Examples}
     */
    async run(prompt: string, options: RunOptions = {}): Promise<string> {
        // Apply default function call mode if not specified
        const optionsWithDefaults = functionCallOps.applyDefaultFunctionCallMode(
            options,
            this.functionCallManager
        );

        return conversationOps.executePrompt(
            prompt,
            optionsWithDefaults,
            this.executionService,
            this.conversationHistory,
            this.systemMessageManager
        );
    }

    /**
     * Execute AI conversation with streaming response
     * 
     * Like run() but returns streaming chunks for real-time display.
     * 
     * @param prompt - User input text  
     * @param options - Optional run configuration
     * @returns Promise resolving to async iterable of response chunks
     * 
     * @throws {Error} When limits exceeded or execution fails
     */
    async runStream(prompt: string, options: RunOptions = {}): Promise<AsyncIterable<StreamingResponseChunk>> {
        return conversationOps.executeStream(
            prompt,
            options,
            this.executionService,
            this.conversationHistory,
            this.systemMessageManager
        );
    }

    // ============================================================
    // Conversation Management
    // ============================================================

    /**
     * Add a response message to conversation history manually
     * 
     * Usually not needed as run() handles this automatically.
     * Useful for advanced conversation management scenarios.
     * 
     * @param response - Model response object to add to history
     */
    addResponseToConversationHistory(response: ModelResponse): void {
        conversationOps.addResponseToConversationHistory(response, this.conversationHistory);
    }

    /**
     * Clear all conversation history
     * 
     * Removes all messages from the conversation history.
     * Useful for starting fresh conversations or managing memory usage.
     */
    clearConversationHistory(): void {
        conversationOps.clearConversationHistory(this.conversationHistory);
    }

    // ============================================================
    // Tool Management
    // ============================================================

    /**
     * Call a specific tool directly
     * 
     * Allows manual tool execution outside of AI-driven tool calling.
     * Useful for testing tools or direct integration scenarios.
     * 
     * @param toolName - Name of the tool to call
     * @param parameters - Parameters to pass to the tool
     * @returns Promise resolving to the tool's result
     * 
     * @throws {Error} When tool is not found or call fails
     */
    async callTool(toolName: string, parameters: Record<string, any>): Promise<any> {
        return toolOps.callTool(toolName, parameters, this.toolProviderManager);
    }

    /**
     * Get list of all available tools
     * 
     * Returns metadata about all registered tools including their schemas.
     * Useful for debugging or building tool selection UIs.
     * 
     * @returns Array of tool metadata objects
     */
    getAvailableTools(): any[] {
        return toolOps.getAvailableTools(this.toolProviderManager);
    }

    // ============================================================
    // Resource Management
    // ============================================================

    /**
     * Release all resources and close connections
     * 
     * Should be called when the Robota instance is no longer needed.
     * Ensures proper cleanup of AI provider connections and resources.
     * 
     * @returns Promise that resolves when cleanup is complete
     */
    async close(): Promise<void> {
        // Close any open connections or resources
        // Currently no cleanup needed, but this provides a hook for future cleanup
        if (this.debug) {
            this.logger.info('Robota instance closed');
        }
    }
} 
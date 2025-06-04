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
     * Created with functions like createMcpToolProvider, createOpenAPIToolProvider, createZodFunctionToolProvider, etc.
     * 
     * @example
     * ```typescript
     * const mcpProvider = createMcpToolProvider({...});
     * const openApiProvider = createOpenAPIToolProvider({...});
     * toolProviders: [mcpProvider, openApiProvider]
     * ```
     */
    toolProviders?: ToolProvider[];

    /** 
     * AI providers - Register multiple AI providers by name
     * 
     * @example
     * ```typescript
     * aiProviders: {
     *   openai: new OpenAIProvider({...}),
     *   anthropic: new AnthropicProvider({...})
     * }
     * ```
     */
    aiProviders?: Record<string, AIProvider>;

    /** 
     * Current AI provider name to use from registered providers
     * Must match a key in aiProviders
     */
    currentProvider?: string;

    /** 
     * Current model name to use with the selected provider
     * 
     * @example 'gpt-4', 'claude-3-sonnet', 'gemini-pro'
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
     * 
     * @example 'You are a helpful AI assistant specialized in coding.'
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
 * @example Basic Usage
 * ```typescript
 * const robota = new Robota({
 *   aiProviders: { openai: openaiProvider },
 *   currentProvider: 'openai',
 *   currentModel: 'gpt-4',
 *   systemPrompt: 'You are a helpful AI assistant.'
 * });
 * 
 * const response = await robota.run('Hello, how are you?');
 * console.log(response);
 * ```
 * 
 * @example With Tools
 * ```typescript
 * const robota = new Robota({
 *   aiProviders: { openai: openaiProvider },
 *   currentProvider: 'openai',
 *   currentModel: 'gpt-4',
 *   toolProviders: [mcpToolProvider, zodFunctionProvider],
 *   onToolCall: (toolName, params, result) => {
 *     console.log(`Tool ${toolName} called with:`, params);
 *   }
 * });
 * ```
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
     * @example
     * ```typescript
     * robota.addAIProvider('claude', new AnthropicProvider({
     *   apiKey: 'your-anthropic-key'
     * }));
     * ```
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
     * 
     * @example
     * ```typescript
     * robota.setCurrentAI('openai', 'gpt-4-turbo');
     * robota.setCurrentAI('anthropic', 'claude-3-sonnet-20240229');
     * ```
     */
    setCurrentAI(providerName: string, model: string): void {
        aiProviderOps.setCurrentAI(providerName, model, this.aiProviderManager, this.configManager);
    }

    /**
     * Get the currently configured AI provider and model
     * 
     * @returns Object containing current provider and model names
     * 
     * @example
     * ```typescript
     * const { provider, model } = robota.getCurrentAI();
     * console.log(`Using ${provider} with model ${model}`);
     * ```
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
     * @example
     * ```typescript
     * robota.setSystemPrompt('You are an expert TypeScript developer who writes clean, well-documented code.');
     * ```
     */
    setSystemPrompt(prompt: string): void {
        systemMessageOps.setSystemPrompt(prompt, this.systemMessageManager, this.configManager);
    }

    /**
     * Set multiple system messages for complex system configuration
     * 
     * @param messages - Array of system messages
     * 
     * @example
     * ```typescript
     * robota.setSystemMessages([
     *   { role: 'system', content: 'You are a helpful assistant.' },
     *   { role: 'system', content: 'Always provide code examples when explaining concepts.' }
     * ]);
     * ```
     */
    setSystemMessages(messages: Message[]): void {
        systemMessageOps.setSystemMessages(messages, this.systemMessageManager);
    }

    /**
     * Add a single system message to existing system messages
     * 
     * @param content - Content of the system message to add
     * 
     * @example
     * ```typescript
     * robota.addSystemMessage('Always explain your reasoning step by step.');
     * ```
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
     * 
     * @example
     * ```typescript
     * robota.setFunctionCallMode('auto'); // Let AI decide when to use tools
     * robota.setFunctionCallMode('none'); // Disable tool usage
     * robota.setFunctionCallMode('required'); // Force tool usage
     * ```
     */
    setFunctionCallMode(mode: FunctionCallMode): void {
        functionCallOps.setFunctionCallMode(mode, this.functionCallManager);
    }

    /**
     * Configure function call settings comprehensively
     * 
     * @param config - Function call configuration object
     * 
     * @example
     * ```typescript
     * robota.configureFunctionCall({
     *   mode: 'auto',
     *   maxCalls: 5,
     *   timeout: 30000,
     *   allowedFunctions: ['search_web', 'calculate']
     * });
     * ```
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
     * @example
     * ```typescript
     * robota.setMaxTokenLimit(50000); // Set limit to 50k tokens
     * robota.setMaxTokenLimit(0);     // Remove token limit
     * ```
     */
    setMaxTokenLimit(limit: number): void {
        analyticsOps.setMaxTokenLimit(limit, this.requestLimitManager);
    }

    /**
     * Set maximum request limit (0 = unlimited)
     * 
     * @param limit - Maximum number of requests (0 for unlimited)
     * 
     * @example
     * ```typescript
     * robota.setMaxRequestLimit(100); // Set limit to 100 requests
     * robota.setMaxRequestLimit(0);   // Remove request limit
     * ```
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
     * @example
     * ```typescript
     * const info = robota.getLimitInfo();
     * console.log(`Tokens: ${info.tokens.used}/${info.tokens.max}`);
     * console.log(`Requests: ${info.requests.used}/${info.requests.max}`);
     * ```
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
     * @example
     * ```typescript
     * const analytics = robota.getAnalytics();
     * console.log('Average response time:', analytics.averageResponseTime);
     * console.log('Total conversations:', analytics.totalConversations);
     * ```
     */
    getAnalytics() {
        return analyticsOps.getAnalytics(this.analyticsManager);
    }

    /**
     * Reset all analytics and usage counters
     * 
     * Clears conversation history, resets token/request counters,
     * and removes all analytics data. Useful for starting fresh.
     * 
     * @example
     * ```typescript
     * robota.resetAnalytics(); // Start fresh tracking
     * ```
     */
    resetAnalytics(): void {
        analyticsOps.resetAnalytics(this.analyticsManager, this.requestLimitManager);
    }

    /**
     * Get token usage statistics for a specific time period
     * 
     * @param startDate - Start date for the period
     * @param endDate - End date for the period (optional, defaults to now)
     * @returns Token usage data for the specified period
     * 
     * @example
     * ```typescript
     * const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
     * const usage = robota.getTokenUsageByPeriod(lastWeek);
     * console.log('Tokens used last week:', usage.totalTokens);
     * ```
     */
    getTokenUsageByPeriod(startDate: Date, endDate?: Date) {
        return analyticsOps.getTokenUsageByPeriod(startDate, endDate, this.analyticsManager);
    }

    // ============================================================
    // Core Execution Methods
    // ============================================================

    /**
     * Execute a text prompt and return the AI response
     * 
     * This is the primary method for interacting with the AI.
     * Handles conversation history, tool calling, and analytics automatically.
     * 
     * @param prompt - The text prompt to send to the AI
     * @param options - Optional execution configuration
     * @returns Promise resolving to the AI's response text
     * 
     * @throws {Error} When AI provider is not configured
     * @throws {Error} When request/token limits are exceeded
     * 
     * @example
     * ```typescript
     * const response = await robota.run('Explain TypeScript generics');
     * console.log(response);
     * ```
     * 
     * @example With options
     * ```typescript
     * const response = await robota.run('Generate code', {
     *   functionCallMode: 'required',
     *   temperature: 0.1
     * });
     * ```
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
     * Generate streaming response for a text prompt
     * 
     * Similar to run() but returns an async iterator for streaming responses.
     * Useful for real-time display of AI responses.
     * 
     * @param prompt - The text prompt to send to the AI
     * @param options - Optional execution configuration
     * @returns Promise resolving to an async iterator of response chunks
     * 
     * @throws {Error} When AI provider is not configured
     * @throws {Error} When streaming is not supported by the provider
     * 
     * @example
     * ```typescript
     * const stream = await robota.runStream('Tell me a story');
     * for await (const chunk of stream) {
     *   if (chunk.content) {
     *     process.stdout.write(chunk.content);
     *   }
     * }
     * ```
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
     * 
     * @example
     * ```typescript
     * robota.addResponseToConversationHistory({
     *   content: 'Manual response',
     *   usage: { totalTokens: 50 }
     * });
     * ```
     */
    addResponseToConversationHistory(response: ModelResponse): void {
        conversationOps.addResponseToConversationHistory(response, this.conversationHistory);
    }

    /**
     * Clear all conversation history
     * 
     * Removes all messages from the conversation history.
     * Useful for starting fresh conversations or managing memory usage.
     * 
     * @example
     * ```typescript
     * robota.clearConversationHistory(); // Start fresh conversation
     * ```
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
     * 
     * @example
     * ```typescript
     * const result = await robota.callTool('web_search', {
     *   query: 'TypeScript best practices',
     *   limit: 5
     * });
     * console.log(result);
     * ```
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
     * 
     * @example
     * ```typescript
     * const tools = robota.getAvailableTools();
     * tools.forEach(tool => {
     *   console.log(`Tool: ${tool.name} - ${tool.description}`);
     * });
     * ```
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
     * 
     * @example
     * ```typescript
     * await robota.close(); // Clean shutdown
     * ```
     */
    async close(): Promise<void> {
        // Close any open connections or resources
        // Currently no cleanup needed, but this provides a hook for future cleanup
        if (this.debug) {
            this.logger.info('Robota instance closed');
        }
    }
} 
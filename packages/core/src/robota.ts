import type {
    RunOptions
} from './types';
import type { AIProvider, Message, ModelResponse, StreamingResponseChunk } from './interfaces/ai-provider';
import type { Logger } from './interfaces/logger';
import type { ConversationHistory } from './conversation-history';
import type { ToolProvider } from '@robota-sdk/tools';
import type { RobotaComplete } from './interfaces/robota-core';

import { SimpleConversationHistory } from './conversation-history';
import { AIProviderManager } from './managers/ai-provider-manager';
import { ToolProviderManager } from './managers/tool-provider-manager';
import { SystemMessageManager } from './managers/system-message-manager';
import { FunctionCallManager, type FunctionCallConfig } from './managers/function-call-manager';
import { AnalyticsManager } from './managers/analytics-manager';
import { RequestLimitManager } from './managers/request-limit-manager';
import { TokenAnalyzer } from './analyzers/token-analyzer';
import { ConversationService } from './services/conversation-service';
import { ExecutionService } from './services/execution-service';
import { RobotaConfigManager, type RobotaConfigInput } from './managers/robota-config-manager';

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

    /** 
     * Legacy option: Single tool provider (use toolProviders array instead)
     * @deprecated Use toolProviders array instead
     */
    provider?: ToolProvider;
}

/**
 * Main Robota class for AI agent interaction with Facade pattern
 * 
 * Provides a high-level interface for AI conversations with support for:
 * - Multiple AI providers (OpenAI, Anthropic, Google, etc.)
 * - Tool/function calling
 * - Conversation history management
 * - Request limiting and analytics
 * - Streaming responses
 * 
 * Uses Facade pattern to expose functional managers while keeping core interface simple.
 * Access detailed functionality through the exposed managers:
 * - ai: AI provider management
 * - system: System message management  
 * - functions: Function/tool call management
 * - analytics: Usage analytics and metrics
 * - tools: Tool provider management
 * - conversation: Conversation history management
 * 
 * @see {@link ../../../apps/examples/01-basic | Basic Usage Examples}
 * @see {@link ../../../apps/examples/05-advanced | Advanced Configuration Examples}
 * 
 * @public
 */
export class Robota implements RobotaComplete {
    /** @internal Configuration manager handling all settings */
    private readonly configManager: RobotaConfigManager;

    /** @internal Service handling execution logic */
    private readonly executionService: ExecutionService;

    /** @internal Conversation service for high-level operations */
    private readonly conversationService: ConversationService;

    /** @internal Token analysis utilities */
    private readonly tokenAnalyzer: TokenAnalyzer;

    /** @internal Conversation history storage */
    private readonly conversationHistory: ConversationHistory;

    /** @internal Optional tool call callback */
    private readonly onToolCall?: (toolName: string, params: any, result: any) => void;

    /** @internal Logger instance */
    private readonly logger: Logger;

    /** @internal Debug mode flag */
    private readonly debug: boolean;

    // === FACADE PATTERN: Exposed Managers ===

    /** 
     * AI provider management - register providers, set current provider/model, configure parameters
     * 
     * @see {@link AIProviderManager} 
     */
    public readonly ai: AIProviderManager;

    /** 
     * System message management - set prompts, manage system instructions
     * 
     * @see {@link SystemMessageManager}
     */
    public readonly system: SystemMessageManager;

    /** 
     * Function/tool call management - configure modes, timeouts, allowed functions
     * 
     * @see {@link FunctionCallManager}
     */
    public readonly functions: FunctionCallManager;

    /** 
     * Analytics and metrics - track usage, performance, costs
     * 
     * @see {@link AnalyticsManager}
     */
    public readonly analytics: AnalyticsManager;

    /** 
     * Tool provider management - register and manage tool providers
     * 
     * @see {@link ToolProviderManager}
     */
    public readonly tools: ToolProviderManager;

    /** 
     * Request and token limits - control usage and costs
     * 
     * @see {@link RequestLimitManager}
     */
    public readonly limits: RequestLimitManager;

    /** 
     * Conversation history - direct access to conversation management
     * 
     * @see {@link ConversationHistory}
     */
    public readonly conversation: ConversationHistory;

    constructor(options: RobotaOptions = {}) {
        // Store constructor parameters
        this.logger = options.logger || console;
        this.debug = options.debug || false;
        this.onToolCall = options.onToolCall;

        // Initialize conversation history
        this.conversationHistory = options.conversationHistory || new SimpleConversationHistory();
        this.conversation = this.conversationHistory;

        // Initialize managers
        this.ai = new AIProviderManager();
        this.system = new SystemMessageManager();
        this.functions = new FunctionCallManager();
        this.analytics = new AnalyticsManager();
        this.tools = new ToolProviderManager(this.logger);
        this.limits = new RequestLimitManager();

        // Initialize services
        this.tokenAnalyzer = new TokenAnalyzer();
        this.conversationService = new ConversationService(
            options.temperature,
            options.maxTokens,
            this.logger,
            this.debug
        );

        // Apply initial configuration first
        this.applyConfiguration(options);

        // Initialize configuration manager with applied configuration
        this.configManager = new RobotaConfigManager({
            aiProviders: options.aiProviders || {},
            currentProvider: options.currentProvider,
            currentModel: options.currentModel,
            temperature: options.temperature,
            maxTokens: options.maxTokens,
            debug: this.debug,
            maxTokenLimit: options.maxTokenLimit || 4096,
            maxRequestLimit: options.maxRequestLimit || 25
        });

        // Initialize execution service
        this.executionService = new ExecutionService(
            this.ai,
            this.tools,
            this.limits,
            this.analytics,
            this.tokenAnalyzer,
            this.conversationService,
            this.logger,
            this.debug,
            this.onToolCall
        );
    }

    /**
     * Apply configuration from options
     * @internal
     */
    private applyConfiguration(options: RobotaOptions): void {
        // Register AI providers
        if (options.aiProviders) {
            for (const [name, provider] of Object.entries(options.aiProviders)) {
                this.ai.addProvider(name, provider);
            }
        }

        // Set current AI provider and model if specified
        if (options.currentProvider && options.currentModel) {
            this.ai.setCurrentAI(options.currentProvider, options.currentModel);
        }

        // Register tool providers (new array format)
        if (options.toolProviders) {
            for (const provider of options.toolProviders) {
                this.tools.addProvider(provider);
            }
        }

        // Handle legacy single provider option
        if (options.provider) {
            this.tools.addProvider(options.provider);
        }

        // Configure system messages
        if (options.systemPrompt) {
            this.system.setSystemPrompt(options.systemPrompt);
        }
        if (options.systemMessages) {
            this.system.setSystemMessages(options.systemMessages);
        }

        // Configure function calling
        if (options.functionCallConfig) {
            this.functions.configure(options.functionCallConfig);
        }

        // Set limits
        if (options.maxTokenLimit) {
            this.limits.setMaxTokens(options.maxTokenLimit);
        }
        if (options.maxRequestLimit) {
            this.limits.setMaxRequests(options.maxRequestLimit);
        }
    }

    // ============================================================
    // Core Execution Methods
    // ============================================================

    /**
 * Execute a prompt and get a text response
 * 
 * Main method for running AI conversations. Handles the full pipeline:
 * - Context preparation with conversation history
 * - AI provider execution with tool support
 * - Response processing and history updates
 * - Analytics and limit tracking
 * 
 * @param prompt - The user prompt to process
 * @param options - Optional configuration for this specific request
 * @returns Promise resolving to the AI's text response
 * 
 * @throws {Error} When no AI provider is configured
 * @throws {Error} When rate limits are exceeded
 * @throws {Error} When AI provider fails
 * 
 * @see {@link ../../../apps/examples/01-basic/01-simple-conversation.ts | Basic Usage}
 */
    async run(prompt: string, options: RunOptions = {}): Promise<string> {
        return this.executionService.executePrompt(prompt, {
            conversationHistory: this.conversationHistory,
            systemMessageManager: this.system,
            options
        });
    }

    /**
     * Execute a prompt and get a streaming response
     * 
     * Similar to run() but returns an async iterator for streaming responses.
     * Useful for real-time display of AI responses.
     * 
     * @param prompt - The user prompt to process
     * @param options - Optional configuration for this specific request
     * @returns Promise resolving to an async iterator of response chunks
     * 
     * @throws {Error} When no AI provider is configured
     * @throws {Error} When rate limits are exceeded
     * @throws {Error} When AI provider fails
     * 
     * @see {@link ../../../apps/examples/01-basic/01-simple-conversation.ts | Streaming Example}
     */
    async runStream(prompt: string, options: RunOptions = {}): Promise<AsyncIterable<StreamingResponseChunk>> {
        return this.executionService.executeStream(prompt, {
            conversationHistory: this.conversationHistory,
            systemMessageManager: this.system,
            options
        });
    }

    /**
 * Call a specific tool directly by name
 * 
 * Bypasses AI provider and calls a tool directly with provided parameters.
 * Useful for testing tools or direct tool execution.
 * 
 * @param toolName - Name of the tool to call
 * @param parameters - Parameters to pass to the tool
 * @returns Promise resolving to the tool's result
 * 
 * @throws {Error} When tool is not found
 * @throws {Error} When tool execution fails
 */
    async callTool(toolName: string, parameters: Record<string, any>): Promise<any> {
        return this.tools.callTool(toolName, parameters);
    }

    /**
     * Get list of available tools
     * 
     * @returns Array of available tool definitions
     */
    getAvailableTools(): any[] {
        return this.tools.getAvailableTools();
    }

    /**
     * Clear all conversation history
     */
    clearConversationHistory(): void {
        this.conversationHistory.clear();
    }

    /**
     * Clean up resources and close connections
     * 
     * Should be called when done using the Robota instance to properly
     * clean up any resources, close connections, etc.
     */
    async close(): Promise<void> {
        // Close AI providers if they support it
        await this.ai.close();

        // Future: Close other resources as needed
    }
} 
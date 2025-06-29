import { BaseAgent } from '../abstracts/base-agent';
import { Message, AgentConfig, RunOptions, AgentInterface } from '../interfaces/agent';
import { BasePlugin } from '../abstracts/base-plugin';
import { AIProviders } from '../managers/ai-provider-manager';
import { Tools } from '../managers/tool-manager';
import { AgentFactory } from '../managers/agent-factory';
import { ConversationHistory } from '../managers/conversation-history-manager';
import { ExecutionService } from '../services/execution-service';
import { AIProvider } from '../interfaces/provider';
import { BaseTool } from '../abstracts/base-tool';
import { Logger, createLogger, setGlobalLogLevel } from '../utils/logger';
import { ConfigurationError } from '../utils/errors';
import type { BaseToolParameters } from '../abstracts/base-tool';
import type { ToolExecutionData, ToolParameters, ToolExecutionContext } from '../interfaces/tool';

/**
 * Reusable type definitions for Robota agent
 */

/**
 * Agent statistics metadata type
 * Used for storing statistics and performance data in getStats method
 */
export type AgentStatsMetadata = Record<string, string | number | boolean | Date | string[]>;

/**
 * Configuration options for creating a Robota instance.
 * Extends AgentConfig with additional options specific to the Robota agent system.
 * 
 * @public
 * @interface
 * @example
 * ```typescript
 * const config: AgentConfig = {
 *   name: 'MyAgent',
 *   aiProviders: { openai: new OpenAIProvider() },
 *   currentProvider: 'openai',
 *   currentModel: 'gpt-4',
 *   tools: [weatherTool, calculatorTool],
 *   plugins: [new LoggingPlugin(), new UsagePlugin()],
 *   logging: { level: 'info', enabled: true }
 * };
 * ```
 */
// Robota uses AgentConfig directly

/**
 * Main AI agent implementation for the Robota SDK.
 * 
 * Robota is a comprehensive AI agent that integrates multiple AI providers, tools, and plugins
 * into a unified conversational interface. Each instance is completely independent with its own
 * managers and services - NO GLOBAL SINGLETONS are used.
 * 
 * Key Features:
 * - Multiple AI provider support (OpenAI, Anthropic, Google)
 * - Function/tool calling with Zod schema validation
 * - Plugin system for extensible functionality
 * - Streaming response support
 * - Conversation history management
 * - Instance-specific resource management
 * 
 * @public
 * @class
 * @extends BaseAgent
 * @implements AgentInterface
 * 
 * @example Basic Usage
 * ```typescript
 * import { Robota } from '@robota-sdk/agents';
 * import { OpenAIProvider } from '@robota-sdk/openai';
 * 
 * const robota = new Robota({
 *   name: 'MyAgent',
 *   aiProviders: { openai: new OpenAIProvider({ apiKey: 'sk-...' }) },
 *   currentProvider: 'openai',
 *   currentModel: 'gpt-4'
 * });
 * 
 * const response = await robota.run('Hello, how are you?');
 * console.log(response);
 * ```
 * 
 * @example With Tools and Plugins
 * ```typescript
 * import { Robota, LoggingPlugin, UsagePlugin } from '@robota-sdk/agents';
 * import { weatherTool, calculatorTool } from './my-tools';
 * 
 * const robota = new Robota({
 *   name: 'AdvancedAgent',
 *   aiProviders: { openai: openaiProvider },
 *   currentProvider: 'openai',
 *   currentModel: 'gpt-4',
 *   tools: [weatherTool, calculatorTool],
 *   plugins: [
 *     new LoggingPlugin({ level: 'info' }),
 *     new UsagePlugin({ trackTokens: true })
 *   ]
 * });
 * 
 * const response = await robota.run('What\'s the weather in Tokyo?');
 * ```
 * 
 * @example Streaming Response
 * ```typescript
 * for await (const chunk of robota.runStream('Tell me a story')) {
 *   process.stdout.write(chunk);
 * }
 * ```
 */
export class Robota extends BaseAgent implements AgentInterface {
    /** The name of this agent instance */
    public readonly name: string;
    /** The version of the Robota agent implementation */
    public readonly version: string = '1.0.0';

    // Instance-specific managers (NO SINGLETONS)
    private aiProviders: AIProviders;
    private tools: Tools;
    private agentFactory: AgentFactory;
    private conversationHistory: ConversationHistory;

    // Core services
    private executionService!: ExecutionService;

    // State management
    protected override config: AgentConfig;
    private conversationId: string;
    private logger: Logger;
    private initializationPromise?: Promise<void>;
    private isFullyInitialized = false;
    private startTime: number;

    /**
     * Creates a new Robota agent instance.
     * 
     * The constructor performs synchronous initialization and validation.
     * Async initialization (AI provider setup, tool registration) is deferred
     * until the first run() call for optimal performance.
     * 
     * @param config - Configuration options for the agent
     * @throws {ConfigurationError} When required configuration is missing or invalid
     * @throws {ValidationError} When configuration values are invalid
     * 
     * @example
     * ```typescript
     * const robota = new Robota({
     *   name: 'CustomerSupport',
     *   aiProviders: {
     *     openai: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }),
     *     anthropic: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY })
     *   },
     *   currentProvider: 'openai',
     *   currentModel: 'gpt-4',
     *   tools: [emailTool, ticketTool],
     *   plugins: [new LoggingPlugin(), new ErrorHandlingPlugin()]
     * });
     * ```
     */
    constructor(config: AgentConfig) {
        super();

        this.name = config.name || 'Robota';
        this.config = config;
        this.conversationId = config.conversationId || `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.logger = createLogger('Robota');
        this.startTime = Date.now();

        // Apply logging configuration
        if (config.logging) {
            if (config.logging.level) {
                setGlobalLogLevel(config.logging.level);
            }
            if (config.logging.enabled === false) {
                setGlobalLogLevel('silent');
            }
        }

        // Validate configuration
        this.validateConfig(config);

        // Create INSTANCE-SPECIFIC managers (NO SINGLETONS)
        this.aiProviders = this.createAIProvidersInstance();
        this.tools = this.createToolsInstance();
        this.agentFactory = this.createAgentFactoryInstance();
        this.conversationHistory = this.createConversationHistoryInstance();

        // ExecutionService will be initialized after async setup is complete

        this.logger.debug('Robota created with independent managers (not yet initialized)', {
            name: this.name,
            conversationId: this.conversationId,
            providersCount: Object.keys(config.aiProviders || {}).length,
            toolsCount: config.tools?.length || 0,
            pluginsCount: config.plugins?.length || 0,
            currentProvider: config.currentProvider,
            currentModel: config.currentModel || config.model
        });
    }

    /**
     * Create instance-specific AIProviders manager
     */
    private createAIProvidersInstance(): AIProviders {
        return new AIProviders();
    }

    /**
     * Create instance-specific Tools manager
     */
    private createToolsInstance(): Tools {
        return new Tools();
    }

    /**
     * Create instance-specific AgentFactory manager
     */
    private createAgentFactoryInstance(): AgentFactory {
        return new AgentFactory();
    }

    /**
     * Create instance-specific ConversationHistory manager
     */
    private createConversationHistoryInstance(): ConversationHistory {
        return new ConversationHistory();
    }

    /**
     * Ensure full initialization has occurred
     */
    private async ensureFullyInitialized(): Promise<void> {
        if (this.isFullyInitialized) {
            return;
        }

        if (!this.initializationPromise) {
            this.initializationPromise = this.performAsyncInitialization();
        }

        await this.initializationPromise;
    }

    /**
     * Perform actual async initialization
     */
    private async performAsyncInitialization(): Promise<void> {
        this.logger.debug('Starting Robota initialization with independent managers');

        try {
            // Initialize all instance-specific managers
            await Promise.all([
                this.aiProviders.initialize(),
                this.tools.initialize(),
                this.agentFactory.initialize()
            ]);

            // Register AI providers after manager initialization
            if (this.config.aiProviders) {
                for (const [name, provider] of Object.entries(this.config.aiProviders)) {
                    this.aiProviders.addProvider(name, provider);
                }
            }

            // Set current provider
            if (this.config.currentProvider && this.config.currentModel) {
                this.aiProviders.setCurrentProvider(this.config.currentProvider, this.config.currentModel);
            }

            // Register tools
            if (this.config.tools) {
                for (const tool of this.config.tools) {
                    // Convert BaseTool to ToolSchema and executor
                    // Create an adapter to convert ToolResult to ToolExecutionData
                    const toolExecutor = async (parameters: BaseToolParameters, context?: ToolExecutionContext): Promise<ToolExecutionData> => {
                        // Create proper ToolExecutionContext for BaseTool.execute
                        const toolContext: ToolExecutionContext = {
                            toolName: tool.schema.name,
                            parameters: parameters as ToolParameters,
                            ...(context?.userId && { userId: context.userId }),
                            ...(context?.sessionId && { sessionId: context.sessionId }),
                            ...(context?.metadata && { metadata: context.metadata })
                        };

                        const result = await tool.execute(parameters, toolContext);
                        return result.data ?? result;
                    };
                    this.tools.addTool(tool.schema, toolExecutor);
                    this.logger.debug('Tool registered during initialization', { toolName: tool.schema.name });
                }
            }

            // NOW initialize ExecutionService after all managers are set up
            this.executionService = new ExecutionService(
                this.aiProviders,
                this.tools,
                this.conversationHistory
            );

            // Register plugins with ExecutionService after it's created
            if (this.config.plugins) {
                for (const plugin of this.config.plugins) {
                    this.executionService.registerPlugin(plugin);
                }
            }

            this.isFullyInitialized = true;
            this.logger.debug('Robota initialization completed successfully with independent managers');

        } catch (error) {
            this.logger.error('Robota initialization failed', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Initialize the agent if not already done
     * @internal
     */
    protected override async initialize(): Promise<void> {
        await this.ensureFullyInitialized();
    }

    /**
     * Execute a conversation turn with the AI agent.
     * 
     * This is the primary method for interacting with the agent. It processes user input,
     * manages conversation history, executes any required tools, and returns the AI response.
     * The method automatically initializes the agent on first use.
     * 
     * @param input - The user's message or prompt to send to the AI
     * @param options - Optional configuration for this specific execution
     * @returns Promise that resolves to the AI's response as a string
     * 
     * @throws {ConfigurationError} When the agent configuration is invalid
     * @throws {ProviderError} When the AI provider encounters an error
     * @throws {ToolExecutionError} When a tool execution fails
     * 
     * @example Basic conversation
     * ```typescript
     * const response = await robota.run('Hello, how are you?');
     * console.log(response); // "Hello! I'm doing well, thank you for asking..."
     * ```
     * 
     * @example With execution options
     * ```typescript
     * const response = await robota.run('Analyze this data', {
     *   sessionId: 'user-123',
     *   userId: 'john.doe',
     *   metadata: { source: 'web-app', priority: 'high' }
     * });
     * ```
     * 
     * @example Error handling
     * ```typescript
     * try {
     *   const response = await robota.run('Complex request');
     * } catch (error) {
     *   if (error instanceof ToolExecutionError) {
     *     console.error('Tool failed:', error.toolName, error.message);
     *   }
     * }
     * ```
     */
    async run(input: string, options: RunOptions = {}): Promise<string> {
        await this.ensureFullyInitialized();

        try {
            this.logger.debug('Starting Robota execution', {
                inputLength: input.length,
                conversationId: this.conversationId,
                sessionId: options.sessionId || 'none',
                userId: options.userId || 'none',
                hasMetadata: !!options.metadata
            });

            // Get current conversation history from centralized manager
            const messages = this.getHistory();

            // Prepare execution config with current provider/model settings
            const executionConfig: AgentConfig = {
                ...this.config,
                model: this.config.currentModel || this.config.model,
                provider: this.config.currentProvider || this.config.provider
            };

            // Execute using execution service
            const result = await this.executionService.execute(
                input,
                messages,
                executionConfig,
                {
                    conversationId: this.conversationId,
                    ...(options.sessionId && { sessionId: options.sessionId }),
                    ...(options.userId && { userId: options.userId }),
                    ...(options.metadata && { metadata: options.metadata })
                }
            );

            this.logger.debug('Robota execution completed', {
                success: result.success,
                duration: result.duration,
                tokensUsed: result.tokensUsed,
                toolsExecuted: result.toolsExecuted
            });

            if (!result.success && result.error) {
                throw result.error;
            }

            return result.response;

        } catch (error) {
            this.logger.error('Robota execution failed', {
                error: error instanceof Error ? error.message : String(error),
                conversationId: this.conversationId
            });
            throw error;
        }
    }

    /**
     * Execute a conversation turn with streaming response.
     * 
     * Similar to run() but returns an async generator that yields response chunks
     * as they arrive from the AI provider. This enables real-time streaming of
     * the AI's response for better user experience.
     * 
     * @param input - The user's message or prompt to send to the AI
     * @param options - Optional configuration for this specific execution
     * @returns AsyncGenerator that yields string chunks of the AI response
     * 
     * @throws {ConfigurationError} When the agent configuration is invalid
     * @throws {ProviderError} When the AI provider encounters an error
     * @throws {ToolExecutionError} When a tool execution fails
     * 
     * @example Basic streaming
     * ```typescript
     * for await (const chunk of robota.runStream('Tell me a story')) {
     *   process.stdout.write(chunk);
     * }
     * console.log('\n'); // New line after story
     * ```
     * 
     * @example Collecting full response
     * ```typescript
     * let fullResponse = '';
     * for await (const chunk of robota.runStream('Explain quantum computing')) {
     *   fullResponse += chunk;
     *   updateUI(chunk); // Update UI in real-time
     * }
     * console.log('Complete response:', fullResponse);
     * ```
     * 
     * @example Error handling in streams
     * ```typescript
     * try {
     *   for await (const chunk of robota.runStream('Complex request')) {
     *     handleChunk(chunk);
     *   }
     * } catch (error) {
     *   console.error('Streaming failed:', error.message);
     * }
     * ```
     */
    async* runStream(input: string, options: RunOptions = {}): AsyncGenerator<string, void, undefined> {
        await this.ensureFullyInitialized();

        try {
            this.logger.debug('Starting Robota streaming execution', {
                inputLength: input.length,
                conversationId: this.conversationId,
                sessionId: options.sessionId || 'none',
                userId: options.userId || 'none',
                hasMetadata: !!options.metadata
            });

            // Get current conversation history from centralized manager
            const messages = this.getHistory();

            // Prepare execution config with current provider/model settings
            const executionConfig: AgentConfig = {
                ...this.config,
                model: this.config.currentModel || this.config.model,
                provider: this.config.currentProvider || this.config.provider
            };

            // Execute using execution service
            const stream = this.executionService.executeStream(
                input,
                messages,
                executionConfig,
                {
                    conversationId: this.conversationId,
                    ...(options.sessionId && { sessionId: options.sessionId }),
                    ...(options.userId && { userId: options.userId }),
                    ...(options.metadata && { metadata: options.metadata })
                }
            );

            for await (const chunk of stream) {
                yield chunk.chunk;
            }

        } catch (error) {
            this.logger.error('Robota streaming execution failed', {
                error: error instanceof Error ? error.message : String(error),
                conversationId: this.conversationId
            });
            throw error;
        }
    }

    /**
     * Get the conversation history for this agent instance.
     * 
     * Returns an array of messages representing the complete conversation history
     * for this agent's conversation session. The history includes user messages,
     * assistant responses, and tool call results.
     * 
     * @returns Array of Message objects representing the conversation history
     * 
     * @example
     * ```typescript
     * await robota.run('What is 2 + 2?');
     * await robota.run('What about 3 + 3?');
     * 
     * const history = robota.getHistory();
     * console.log(history.length); // 4 (2 user messages, 2 assistant responses)
     * console.log(history[0].role); // 'user'
     * console.log(history[0].content); // 'What is 2 + 2?'
     * ```
     */
    override getHistory(): Message[] {
        const conversationSession = this.conversationHistory.getConversationSession(this.conversationId);
        const universalMessages = conversationSession.getMessages();

        return universalMessages.map(msg => ({
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp,
            metadata: msg.metadata,
            ...(msg.role === 'assistant' && 'toolCalls' in msg ? { toolCalls: msg.toolCalls } : {}),
            ...(msg.role === 'tool' && 'toolCallId' in msg ? { toolCallId: msg.toolCallId } : {})
        })) as Message[];
    }

    /**
     * Clear the conversation history for this agent instance.
     * 
     * Removes all messages from the conversation history, starting fresh.
     * This does not affect the agent's configuration or other state.
     * 
     * @example
     * ```typescript
     * await robota.run('First message');
     * console.log(robota.getHistory().length); // 2 (user + assistant)
     * 
     * robota.clearHistory();
     * console.log(robota.getHistory().length); // 0
     * ```
     */
    override clearHistory(): void {
        const conversationSession = this.conversationHistory.getConversationSession(this.conversationId);
        conversationSession.clear();
        this.logger.debug('Conversation history cleared', { conversationId: this.conversationId });
    }

    /**
     * Add a plugin to the agent at runtime.
     * 
     * Plugins provide extensible functionality through lifecycle hooks.
     * This method allows dynamic addition of plugins after agent creation.
     * 
     * @param plugin - The plugin instance to add
     * 
     * @example
     * ```typescript
     * import { UsagePlugin, PerformancePlugin } from '@robota-sdk/agents';
     * 
     * const robota = new Robota(config);
     * 
     * // Add plugins dynamically
     * robota.addPlugin(new UsagePlugin({ trackTokens: true }));
     * robota.addPlugin(new PerformancePlugin({ trackMemory: true }));
     * ```
     */
    addPlugin(plugin: BasePlugin): void {
        this.executionService.registerPlugin(plugin);
        this.logger.debug('Plugin added', { pluginName: plugin.name });
    }

    /**
     * Remove a plugin from the agent by name.
     * 
     * @param pluginName - The name of the plugin to remove
     * @returns true if the plugin was found and removed, false otherwise
     * 
     * @example
     * ```typescript
     * const removed = robota.removePlugin('usage-plugin');
     * if (removed) {
     *   console.log('Plugin removed successfully');
     * } else {
     *   console.log('Plugin not found');
     * }
     * ```
     */
    removePlugin(pluginName: string): boolean {
        const removed = this.executionService.removePlugin(pluginName);
        if (removed) {
            this.logger.debug('Plugin removed', { pluginName });
        }
        return removed;
    }

    /**
     * Get a specific plugin by name with type safety.
     * 
     * @template T - The expected plugin type extending BasePlugin
     * @param pluginName - The name of the plugin to retrieve
     * @returns The plugin instance if found, null otherwise
     * 
     * @example
     * ```typescript
     * import { UsagePlugin } from '@robota-sdk/agents';
     * 
     * const usagePlugin = robota.getPlugin<UsagePlugin>('usage-plugin');
     * if (usagePlugin) {
     *   const stats = usagePlugin.getUsageStats();
     *   console.log('Token usage:', stats.totalTokens);
     * }
     * ```
     */
    getPlugin<T extends BasePlugin = BasePlugin>(pluginName: string): T | null {
        return this.executionService.getPlugin<T>(pluginName);
    }

    /**
     * Get all registered plugins.
     * 
     * @returns Array of all currently registered plugin instances
     * 
     * @example
     * ```typescript
     * const plugins = robota.getPlugins();
     * console.log(`Agent has ${plugins.length} plugins registered`);
     * plugins.forEach(plugin => {
     *   console.log(`- ${plugin.name} (${plugin.version})`);
     * });
     * ```
     */
    getPlugins(): BasePlugin[] {
        return this.executionService.getPlugins();
    }

    /**
     * Get all plugin names currently registered.
     * 
     * @returns Array of plugin names
     * 
     * @example
     * ```typescript
     * const pluginNames = robota.getPluginNames();
     * console.log('Active plugins:', pluginNames.join(', '));
     * // Output: "Active plugins: logging-plugin, usage-plugin, performance-plugin"
     * ```
     */
    getPluginNames(): string[] {
        return this.executionService.getPlugins().map(plugin => plugin.name);
    }

    /**
     * Register a new AI provider at runtime.
     * 
     * Allows dynamic addition of AI providers after agent creation.
     * The provider can then be selected using switchProvider().
     * 
     * @param name - Unique name for the provider
     * @param provider - The AI provider instance to register
     * 
     * @example
     * ```typescript
     * import { AnthropicProvider } from '@robota-sdk/anthropic';
     * 
     * const anthropicProvider = new AnthropicProvider({ 
     *   apiKey: process.env.ANTHROPIC_API_KEY 
     * });
     * 
     * robota.registerProvider('anthropic', anthropicProvider);
     * robota.switchProvider('anthropic', 'claude-3-opus-20240229');
     * ```
     */
    registerProvider(name: string, provider: AIProvider): void {
        this.aiProviders.addProvider(name, provider);
        this.logger.debug('AI provider registered', { providerName: name });
    }

    /**
     * Switch to a different AI provider and model.
     * 
     * Changes the current active provider and model for subsequent conversations.
     * The provider must be previously registered via constructor or registerProvider().
     * 
     * @param providerName - Name of the provider to switch to
     * @param model - Model identifier supported by the provider
     * 
     * @throws {ConfigurationError} When the provider is not registered
     * @throws {ValidationError} When the model is not supported by the provider
     * 
     * @example
     * ```typescript
     * // Switch from OpenAI to Anthropic
     * robota.switchProvider('anthropic', 'claude-3-opus-20240229');
     * 
     * // Switch back to OpenAI with a different model
     * robota.switchProvider('openai', 'gpt-4-turbo-preview');
     * 
     * // Verify the switch
     * const stats = robota.getStats();
     * console.log('Current provider:', stats.currentProvider);
     * ```
     */
    switchProvider(providerName: string, model: string): void {
        this.aiProviders.setCurrentProvider(providerName, model);
        this.config.currentProvider = providerName;
        this.config.currentModel = model;
        this.logger.debug('Switched AI provider', { provider: providerName, model });
    }

    /**
     * Register a new tool for function calling.
     * 
     * Adds a tool that the AI can call during conversations. The tool's schema
     * defines its name, description, and parameters for the AI to understand.
     * 
     * @param tool - The tool instance to register
     * 
     * @example
     * ```typescript
     * import { BaseTool } from '@robota-sdk/agents';
     * 
     * class WeatherTool extends BaseTool {
     *   name = 'get_weather';
     *   description = 'Get current weather for a location';
     *   
     *   get schema() {
     *     return {
     *       name: this.name,
     *       description: this.description,
     *       parameters: {
     *         type: 'object',
     *         properties: {
     *           location: { type: 'string', description: 'City name' }
     *         },
     *         required: ['location']
     *       }
     *     };
     *   }
     *   
     *   async execute(params: { location: string }) {
     *     // Implementation here
     *     return { temperature: 22, condition: 'sunny' };
     *   }
     * }
     * 
     * robota.registerTool(new WeatherTool());
     * ```
     */
    registerTool(tool: BaseTool): void {
        // Check if tool is already registered to prevent duplicates
        if (this.tools.hasTool(tool.schema.name)) {
            this.logger.warn('Tool already registered, skipping', { toolName: tool.schema.name });
            return;
        }

        // Create an adapter to convert ToolResult to ToolExecutionData
        const toolExecutor = async (parameters: BaseToolParameters, context?: ToolExecutionContext): Promise<ToolExecutionData> => {
            // Create proper ToolExecutionContext for BaseTool.execute
            const toolContext: ToolExecutionContext = {
                toolName: tool.schema.name,
                parameters: parameters as ToolParameters,
                ...(context?.userId && { userId: context.userId }),
                ...(context?.sessionId && { sessionId: context.sessionId }),
                ...(context?.metadata && { metadata: context.metadata })
            };

            const result = await tool.execute(parameters, toolContext);
            return result.data ?? result;
        };
        this.tools.addTool(tool.schema, toolExecutor);
        this.logger.debug('Tool registered', { toolName: tool.schema.name });
    }

    /**
     * Unregister a tool by name.
     * 
     * Removes a previously registered tool, making it unavailable for future AI calls.
     * 
     * @param toolName - Name of the tool to unregister
     * 
     * @example
     * ```typescript
     * robota.unregisterTool('weather-tool');
     * 
     * const stats = robota.getStats();
     * console.log('Remaining tools:', stats.tools);
     * ```
     */
    unregisterTool(toolName: string): void {
        this.tools.removeTool(toolName);
        this.logger.debug('Tool unregistered', { toolName });
    }

    /**
     * Get the current agent configuration.
     * 
     * Returns a copy of the current configuration object. Modifications to the
     * returned object do not affect the agent - use updateConfig() to make changes.
     * 
     * @returns Copy of the current AgentConfig
     * 
     * @example
     * ```typescript
     * const config = robota.getConfig();
     * console.log('Current model:', config.currentModel);
     * console.log('Available providers:', Object.keys(config.aiProviders || {}));
     * ```
     */
    getConfig(): AgentConfig {
        return { ...this.config };
    }

    /**
     * Update the agent configuration at runtime.
     * 
     * Allows partial updates to the agent configuration. Only specified fields
     * are updated - other configuration remains unchanged.
     * 
     * @param updates - Partial configuration object with fields to update
     * 
     * @example
     * ```typescript
     * // Update AI parameters
     * robota.updateConfig({
     *   temperature: 0.8,
     *   maxTokens: 2000,
     *   topP: 0.9
     * });
     * 
     * // Update logging settings
     * robota.updateConfig({
     *   logging: { level: 'debug', enabled: true }
     * });
     * ```
     */
    updateConfig(updates: Partial<AgentConfig>): void {
        this.config = { ...this.config, ...updates };
        this.logger.debug('Configuration updated', { updates: Object.keys(updates) });
    }

    /**
     * Get comprehensive statistics about the agent.
     * 
     * Returns detailed information about the agent's current state, including
     * registered providers, tools, plugins, conversation metrics, and uptime.
     * 
     * @returns Object containing detailed agent statistics
     * 
     * @example
     * ```typescript
     * const stats = robota.getStats();
     * 
     * console.log(`Agent: ${stats.name} v${stats.version}`);
     * console.log(`Uptime: ${Math.round(stats.uptime / 1000)}s`);
     * console.log(`Current provider: ${stats.currentProvider}`);
     * console.log(`Available providers: ${stats.providers.join(', ')}`);
     * console.log(`Registered tools: ${stats.tools.join(', ')}`);
     * console.log(`Active plugins: ${stats.plugins.join(', ')}`);
     * console.log(`Messages in history: ${stats.historyLength}`);
     * ```
     */
    getStats(): {
        name: string;
        version: string;
        conversationId: string;
        providers: string[];
        currentProvider: string | null;
        tools: string[];
        plugins: string[];
        historyLength: number;
        historyStats: AgentStatsMetadata;
        uptime: number;
    } {
        const conversationSession = this.conversationHistory.getConversationSession(this.conversationId);
        const currentProviderInfo = this.aiProviders.getCurrentProvider();

        return {
            name: this.name,
            version: this.version,
            conversationId: this.conversationId,
            providers: this.aiProviders.getProviderNames(),
            currentProvider: currentProviderInfo ? currentProviderInfo.provider : null,
            tools: this.tools.getTools().map(tool => tool.name),
            plugins: this.executionService.getPlugins().map(p => p.name),
            historyLength: conversationSession.getMessageCount(),
            historyStats: this.conversationHistory.getStats(),
            uptime: Date.now() - this.startTime
        };
    }

    /**
     * Validate the agent configuration.
     * @internal
     */
    private validateConfig(config: AgentConfig): void {
        if (!config.model && !config.currentModel) {
            throw new ConfigurationError(
                'Model must be specified in config.model or config.currentModel',
                { component: 'Robota' }
            );
        }

        if (!config.provider && !config.currentProvider && !config.aiProviders) {
            throw new ConfigurationError(
                'At least one AI provider must be specified',
                { component: 'Robota' }
            );
        }

        // Validate that current provider exists if specified
        if (config.currentProvider && config.aiProviders) {
            if (!config.aiProviders[config.currentProvider]) {
                throw new ConfigurationError(
                    `Current provider '${config.currentProvider}' not found in aiProviders`,
                    { component: 'Robota', currentProvider: config.currentProvider }
                );
            }
        }
    }

    /**
     * Cleanup agent resources and prepare for disposal.
     * 
     * Properly shuts down the agent by cleaning up plugins, disposing managers,
     * and releasing resources. The agent should not be used after calling destroy().
     * Multiple calls to destroy() are safe and will not cause errors.
     * 
     * @example
     * ```typescript
     * // Graceful shutdown
     * await robota.destroy();
     * console.log('Agent shutdown complete');
     * 
     * // Agent is no longer usable
     * // await robota.run('test'); // This would require re-initialization
     * ```
     * 
     * @example In a web server shutdown
     * ```typescript
     * process.on('SIGTERM', async () => {
     *   console.log('Shutting down...');
     *   await robota.destroy();
     *   process.exit(0);
     * });
     * ```
     */
    async destroy(): Promise<void> {
        this.logger.debug('Destroying Robota instance');

        // Clear plugins first
        if (this.executionService) {
            this.executionService.clearPlugins();
        }

        // Dispose instance-specific managers
        await this.aiProviders.dispose();
        await this.tools.dispose();

        this.logger.debug('Robota instance destroyed');
    }
} 
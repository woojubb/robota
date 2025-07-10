import { BaseAgent } from '../abstracts/base-agent';
import { Message, AgentConfig, RunOptions, AgentInterface } from '../interfaces/agent';
import { BasePlugin } from '../abstracts/base-plugin';
import { BaseModule } from '../abstracts/base-module';
import { ModuleRegistry } from '../managers/module-registry';
import { EventEmitterPlugin } from '../plugins/event-emitter-plugin';
import { AIProviders } from '../managers/ai-provider-manager';
import { Tools } from '../managers/tool-manager';
import { AgentFactory } from '../managers/agent-factory';
import { ConversationHistory } from '../managers/conversation-history-manager';
import { ExecutionService } from '../services/execution-service';

import { BaseTool } from '../abstracts/base-tool';
import { Logger, createLogger, setGlobalLogLevel } from '../utils/logger';
import { ConfigurationError } from '../utils/errors';
import type { BaseToolParameters } from '../abstracts/base-tool';
import type { ToolExecutionData, ToolParameters, ToolExecutionContext } from '../interfaces/tool';
import type { ModuleResultData, ModuleExecutionContext } from '../abstracts/base-module';

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
 *   aiProviders: [new OpenAIProvider()],
 *   defaultModel: {
 *     provider: 'openai',
 *     model: 'gpt-4'
 *   },
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
 * @extends BaseAgent<AgentConfig, RunOptions, Message>
 * @implements AgentInterface
 * 
 * @example Basic Usage
 * ```typescript
 * import { Robota } from '@robota-sdk/agents';
 * import { OpenAIProvider } from '@robota-sdk/openai';
 * 
 * const robota = new Robota({
 *   name: 'MyAgent',
 *   aiProviders: [new OpenAIProvider({ apiKey: 'sk-...' })],
 *   defaultModel: {
 *     provider: 'openai',
 *     model: 'gpt-4'
 *   }
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
 *   aiProviders: [openaiProvider],
 *   defaultModel: {
 *     provider: 'openai',
 *     model: 'gpt-4'
 *   },
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
export class Robota extends BaseAgent<AgentConfig, RunOptions, Message> implements AgentInterface {
    /** The name of this agent instance */
    public readonly name: string;
    /** The version of the Robota agent implementation */
    public readonly version: string = '1.0.0';

    // Instance-specific managers (NO SINGLETONS)
    private aiProviders: AIProviders;
    private tools: Tools;
    private agentFactory: AgentFactory;
    private conversationHistory: ConversationHistory;

    // Module system integration
    private moduleRegistry: ModuleRegistry;
    private eventEmitter: EventEmitterPlugin;

    // Core services
    private executionService!: ExecutionService;

    // State management
    protected override config: AgentConfig;
    private conversationId: string;
    private logger: Logger;
    private initializationPromise?: Promise<void> | undefined;
    private isFullyInitialized = false;
    private startTime: number;

    /**
     * Creates a new Robota agent instance with the new aiProviders array design.
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
     *   aiProviders: [
     *     new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }),
     *     new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY })
     *   ],
     *   defaultModel: {
     *     provider: 'openai',
     *     model: 'gpt-4',
     *     temperature: 0.7
     *   },
     *   tools: [emailTool, ticketTool],
     *   plugins: [new LoggingPlugin(), new ErrorHandlingPlugin()]
     * });
     * ```
     */
    constructor(config: AgentConfig) {
        super();

        this.name = config.name;
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

        // Validate new configuration format
        this.validateNewConfig(config);

        // Create INSTANCE-SPECIFIC managers (NO SINGLETONS)
        this.aiProviders = this.createAIProvidersInstance();
        this.tools = this.createToolsInstance();
        this.agentFactory = this.createAgentFactoryInstance();
        this.conversationHistory = this.createConversationHistoryInstance();

        // Create module system components
        this.eventEmitter = this.createEventEmitterInstance();
        this.moduleRegistry = this.createModuleRegistryInstance();

        // Store config for async initialization
        this.config = config;

        // ExecutionService will be initialized after async setup is complete

        this.logger.debug('Robota created with new aiProviders array design', {
            name: this.name,
            conversationId: this.conversationId,
            providersCount: config.aiProviders.length,
            toolsCount: config.tools?.length || 0,
            pluginsCount: config.plugins?.length || 0,
            defaultProvider: config.defaultModel.provider,
            defaultModel: config.defaultModel.model
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
     * Create instance-specific EventEmitter plugin
     */
    private createEventEmitterInstance(): EventEmitterPlugin {
        return new EventEmitterPlugin({
            enabled: true,
            events: [
                'execution.start',
                'execution.complete',
                'execution.error',
                'module.initialize.start',
                'module.initialize.complete',
                'module.initialize.error',
                'module.execution.start',
                'module.execution.complete',
                'module.execution.error',
                'module.dispose.start',
                'module.dispose.complete',
                'module.dispose.error'
            ]
        });
    }

    /**
     * Create instance-specific ModuleRegistry
     */
    private createModuleRegistryInstance(): ModuleRegistry {
        return new ModuleRegistry(this.eventEmitter);
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
                for (const provider of this.config.aiProviders) {
                    this.aiProviders.addProvider(provider.name, provider);
                }
            }

            // Set current provider from defaultModel
            if (this.config.defaultModel) {
                this.aiProviders.setCurrentProvider(this.config.defaultModel.provider, this.config.defaultModel.model);
            }

            // Register modules if provided
            if (this.config.modules) {
                for (const module of this.config.modules) {
                    await this.moduleRegistry.registerModule(module, {
                        autoInitialize: true,
                        validateDependencies: true
                    });
                }
                this.logger.debug('Modules registered and initialized', {
                    moduleCount: this.config.modules.length,
                    moduleNames: this.config.modules.map(m => m.name)
                });
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

                    // Subscribe plugin to module events if it supports it
                    if (plugin.subscribeToModuleEvents) {
                        await plugin.subscribeToModuleEvents(this.eventEmitter);
                        this.logger.debug('Plugin subscribed to module events', {
                            pluginName: plugin.name
                        });
                    }
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
                ...this.config
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
                ...this.config
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
     * Get all registered plugin names
     */
    getPluginNames(): string[] {
        if (!this.isFullyInitialized || !this.executionService) {
            return [];
        }
        return this.executionService.getPlugins().map(plugin => plugin.name);
    }

    // ========================================
    // Module Management Methods
    // ========================================

    /**
     * Register a new module with the agent
     * @param module - The module instance to register
     * @param options - Registration options
     */
    async registerModule(module: BaseModule, options?: { autoInitialize?: boolean; validateDependencies?: boolean }): Promise<void> {
        await this.ensureFullyInitialized();

        await this.moduleRegistry.registerModule(module, {
            autoInitialize: options?.autoInitialize ?? true,
            validateDependencies: options?.validateDependencies ?? true
        });

        this.logger.info('Module registered', {
            moduleName: module.name,
            moduleType: module.getModuleType().type
        });
    }

    /**
     * Unregister a module from the agent
     * @param moduleName - Name of the module to unregister
     * @returns True if module was unregistered, false if not found
     */
    async unregisterModule(moduleName: string): Promise<boolean> {
        if (!this.isFullyInitialized) {
            return false;
        }

        const result = await this.moduleRegistry.unregisterModule(moduleName);

        if (result) {
            this.logger.info('Module unregistered', { moduleName });
        }

        return result;
    }

    /**
     * Get a module by name with type safety
     * @param moduleName - Name of the module to retrieve
     * @returns The module instance or null if not found
     */
    getModule<T extends BaseModule = BaseModule>(moduleName: string): T | null {
        if (!this.isFullyInitialized) {
            return null;
        }
        return this.moduleRegistry.getModule<T>(moduleName);
    }

    /**
     * Get modules by type
     * @param moduleType - Type of modules to retrieve
     * @returns Array of modules matching the type
     */
    getModulesByType<T extends BaseModule = BaseModule>(moduleType: string): T[] {
        if (!this.isFullyInitialized) {
            return [];
        }
        return this.moduleRegistry.getModulesByType<T>(moduleType);
    }

    /**
     * Get all registered modules
     * @returns Array of all registered modules
     */
    getModules(): BaseModule[] {
        if (!this.isFullyInitialized) {
            return [];
        }
        return this.moduleRegistry.getAllModules();
    }

    /**
     * Get all registered module names
     * @returns Array of module names
     */
    getModuleNames(): string[] {
        if (!this.isFullyInitialized) {
            return [];
        }
        return this.moduleRegistry.getModuleNames();
    }

    /**
     * Check if a module is registered
     * @param moduleName - Name of the module to check
     * @returns True if module is registered
     */
    hasModule(moduleName: string): boolean {
        if (!this.isFullyInitialized) {
            return false;
        }
        return this.moduleRegistry.hasModule(moduleName);
    }

    /**
     * Execute a module by name
     * @param moduleName - Name of the module to execute
     * @param context - Execution context
     * @returns Module execution result
     */
    async executeModule(moduleName: string, context: { executionId?: string; sessionId?: string; userId?: string; metadata?: Record<string, string | number | boolean | Date> }): Promise<{ success: boolean; data?: ModuleResultData; error?: Error; duration?: number }> {
        await this.ensureFullyInitialized();

        const executionContext: ModuleExecutionContext = {
            agentName: this.name,
            ...(context.executionId && { executionId: context.executionId }),
            ...(context.sessionId && { sessionId: context.sessionId }),
            ...(context.userId && { userId: context.userId }),
            ...(context.metadata && { metadata: context.metadata })
        };

        return await this.moduleRegistry.executeModule(moduleName, executionContext);
    }

    /**
     * Get module execution statistics
     * @param moduleName - Name of the module
     * @returns Module statistics or null if not found
     */
    getModuleStats(moduleName: string): { totalExecutions: number; successfulExecutions: number; failedExecutions: number; averageExecutionTime: number; lastExecutionTime?: Date } | null {
        if (!this.isFullyInitialized) {
            return null;
        }
        return this.moduleRegistry.getModuleStats(moduleName);
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
    /**
     * Set the current model configuration (complete replacement).
     * 
     * Updates the current AI provider, model, and related settings. This completely
     * replaces the current model configuration with the new values.
     * 
     * @param modelConfig - New model configuration
     * 
     * @throws {ConfigurationError} When the provider is not available
     * 
     * @example
     * ```typescript
     * // Switch to a different provider and model
     * robota.setModel({
     *   provider: 'anthropic',
     *   model: 'claude-3-opus',
     *   temperature: 0.9,
     *   maxTokens: 4000
     * });
     * 
     * // Simple model change
     * robota.setModel({
     *   provider: 'openai',
     *   model: 'gpt-4-turbo'
     * });
     * ```
     */
    setModel(modelConfig: {
        provider: string;
        model: string;
        temperature?: number;
        maxTokens?: number;
        topP?: number;
        systemMessage?: string;
    }): void {
        // Validate required fields
        if (!modelConfig.provider || !modelConfig.model) {
            throw new ConfigurationError(
                'Both provider and model are required',
                { component: 'Robota' }
            );
        }

        // Ensure managers are initialized before using them
        if (!this.isFullyInitialized) {
            throw new ConfigurationError(
                'Agent must be fully initialized before changing model configuration',
                { component: 'Robota' }
            );
        }

        const availableProviders = this.aiProviders.getProviderNames();
        if (!availableProviders.includes(modelConfig.provider)) {
            throw new ConfigurationError(
                `AI Provider '${modelConfig.provider}' not found. ` +
                `Available: ${availableProviders.join(', ')}`,
                {
                    component: 'Robota',
                    provider: modelConfig.provider,
                    availableProviders
                }
            );
        }

        // Update provider and model
        this.aiProviders.setCurrentProvider(modelConfig.provider, modelConfig.model);

        // Update config with new defaultModel settings only
        this.config = {
            ...this.config,
            defaultModel: {
                ...this.config.defaultModel,
                provider: modelConfig.provider,
                model: modelConfig.model,
                ...(modelConfig.temperature !== undefined && { temperature: modelConfig.temperature }),
                ...(modelConfig.maxTokens !== undefined && { maxTokens: modelConfig.maxTokens }),
                ...(modelConfig.topP !== undefined && { topP: modelConfig.topP }),
                ...(modelConfig.systemMessage !== undefined && { systemMessage: modelConfig.systemMessage })
            }
        };

        this.logger.debug('Model configuration updated', modelConfig);
    }

    /**
     * Get the current model configuration.
     * 
     * Returns the current AI provider, model, and related settings.
     * 
     * @returns Current model configuration
     * 
     * @example
     * ```typescript
     * const current = robota.getModel();
     * console.log(`Current: ${current.provider}/${current.model}`);
     * console.log(`Temperature: ${current.temperature}`);
     * console.log(`Max tokens: ${current.maxTokens}`);
     * ```
     */
    getModel(): {
        provider: string;
        model: string;
        temperature?: number;
        maxTokens?: number;
        topP?: number;
        systemMessage?: string;
    } {
        // Ensure managers are initialized before using them
        if (!this.isFullyInitialized) {
            throw new ConfigurationError(
                'Agent must be fully initialized before getting model configuration',
                { component: 'Robota' }
            );
        }

        const currentProviderInfo = this.aiProviders.getCurrentProvider();
        if (!currentProviderInfo) {
            throw new ConfigurationError(
                'No provider is currently set',
                { component: 'Robota' }
            );
        }

        const currentProvider = currentProviderInfo.provider;
        const currentModel = currentProviderInfo.model;
        const currentTemperature = this.config.defaultModel.temperature;
        const currentMaxTokens = this.config.defaultModel.maxTokens;
        const currentTopP = this.config.defaultModel.topP;
        const currentSystemMessage = this.config.defaultModel.systemMessage;

        return {
            provider: currentProvider,
            model: currentModel,
            ...(currentTemperature !== undefined && { temperature: currentTemperature }),
            ...(currentMaxTokens !== undefined && { maxTokens: currentMaxTokens }),
            ...(currentTopP !== undefined && { topP: currentTopP }),
            ...(currentSystemMessage !== undefined && { systemMessage: currentSystemMessage })
        };
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
     * Get comprehensive agent statistics including providers, tools, plugins, modules, and performance data.
     * 
     * @returns Object containing all agent statistics and metadata
     * 
     * @example
     * ```typescript
     * const stats = robota.getStats();
     * console.log(`Agent: ${stats.name} v${stats.version}`);
     * console.log(`Uptime: ${stats.uptime}ms`);
     * console.log(`Providers: ${stats.providers.join(', ')}`);
     * console.log(`Tools: ${stats.tools.join(', ')}`);
     * console.log(`Plugins: ${stats.plugins.join(', ')}`);
     * console.log(`Modules: ${stats.modules.join(', ')}`);
     * console.log(`Messages: ${stats.historyLength}`);
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
        modules: string[];
        historyLength: number;
        historyStats: AgentStatsMetadata;
        uptime: number;
    } {
        const providers = this.isFullyInitialized ? this.aiProviders.getProviderNames() : [];
        const currentProviderInfo = this.isFullyInitialized ? this.aiProviders.getCurrentProvider() : null;
        const currentProvider = currentProviderInfo ? currentProviderInfo.provider : null;
        const tools = this.isFullyInitialized ? this.tools.getTools().map(tool => tool.name) : [];
        const plugins = this.getPluginNames();
        const modules = this.getModuleNames();
        const history = this.getHistory();
        const uptime = Date.now() - this.startTime;

        return {
            name: this.name,
            version: this.version,
            conversationId: this.conversationId,
            providers,
            currentProvider,
            tools,
            plugins,
            modules,
            historyLength: history.length,
            historyStats: {
                userMessages: history.filter(m => m.role === 'user').length,
                assistantMessages: history.filter(m => m.role === 'assistant').length,
                systemMessages: history.filter(m => m.role === 'system').length,
                toolMessages: history.filter(m => m.role === 'tool').length
            },
            uptime
        };
    }

    /**
     * Validate the new agent configuration format.
     * @internal
     */
    private validateNewConfig(config: AgentConfig): void {
        if (!config.name) {
            throw new ConfigurationError(
                'Agent name is required',
                { component: 'Robota' }
            );
        }

        if (!config.aiProviders || config.aiProviders.length === 0) {
            throw new ConfigurationError(
                'At least one AI provider is required',
                { component: 'Robota' }
            );
        }

        if (!config.defaultModel) {
            throw new ConfigurationError(
                'Default model configuration is required',
                { component: 'Robota' }
            );
        }

        if (!config.defaultModel.provider || !config.defaultModel.model) {
            throw new ConfigurationError(
                'Default model must specify both provider and model',
                { component: 'Robota' }
            );
        }

        // Check for duplicate provider names
        const providerNames = config.aiProviders.map(p => p.name);
        const duplicates = providerNames.filter((name, index) =>
            providerNames.indexOf(name) !== index
        );
        if (duplicates.length > 0) {
            throw new ConfigurationError(
                `Duplicate AI provider names: ${duplicates.join(', ')}`,
                { component: 'Robota', duplicates }
            );
        }

        // Validate that default provider exists in providers list
        if (!providerNames.includes(config.defaultModel.provider)) {
            throw new ConfigurationError(
                `Default provider '${config.defaultModel.provider}' not found in AI providers list. ` +
                `Available: ${providerNames.join(', ')}`,
                {
                    component: 'Robota',
                    defaultProvider: config.defaultModel.provider,
                    availableProviders: providerNames
                }
            );
        }
    }

    /**
     * Clean up and dispose of the agent instance.
     * 
     * This method properly cleans up all resources, managers, and services
     * to prevent memory leaks and ensure graceful shutdown.
     * 
     * @example
     * ```typescript
     * // Clean shutdown
     * await robota.destroy();
     * console.log('Agent destroyed');
     * ```
     */
    async destroy(): Promise<void> {
        this.logger.debug('Destroying Robota instance', { name: this.name });

        try {
            // Dispose all modules first (in reverse dependency order)
            if (this.isFullyInitialized && this.moduleRegistry) {
                await this.moduleRegistry.disposeAllModules();
                this.logger.debug('All modules disposed');
            }

            // Cleanup execution service and plugins
            if (this.executionService) {
                // Unsubscribe plugins from module events
                const plugins = this.executionService.getPlugins();
                for (const plugin of plugins) {
                    if (plugin.unsubscribeFromModuleEvents && this.eventEmitter) {
                        await plugin.unsubscribeFromModuleEvents(this.eventEmitter);
                    }
                }
                this.logger.debug('ExecutionService plugins cleaned up');
            }

            // Clear module registry
            if (this.moduleRegistry) {
                this.moduleRegistry.clearAllModules();
                this.logger.debug('ModuleRegistry cleared');
            }

            // Dispose EventEmitter
            if (this.eventEmitter) {
                await this.eventEmitter.destroy();
                this.logger.debug('EventEmitter disposed');
            }

            // Reset state
            this.isFullyInitialized = false;
            this.initializationPromise = undefined as Promise<void> | undefined;

            this.logger.info('Robota instance destroyed successfully', { name: this.name });

        } catch (error) {
            this.logger.error('Error during Robota destruction', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
} 
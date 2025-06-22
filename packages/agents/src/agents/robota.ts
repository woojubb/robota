import { BaseAgent } from '../abstracts/base-agent';
import { Message, AgentConfig, RunOptions, AgentInterface } from '../interfaces/agent';
import { BasePlugin } from '../abstracts/base-plugin';
import { AIProviders } from '../managers/ai-provider-manager';
import { Tools } from '../managers/tool-manager';
import { AgentFactory } from '../managers/agent-factory';
import { ConversationHistory } from '../managers/conversation-history-manager';
import { Plugins } from '../managers/plugins';
import { ExecutionService } from '../services/execution-service';
import { AIProvider } from '../interfaces/provider';
import { BaseTool } from '../abstracts/base-tool';
import { Logger, UtilLogLevel, setGlobalLogLevel } from '../utils/logger';
import { ConfigurationError } from '../utils/errors';

/**
 * Robota configuration options
 */
export interface RobotaConfig extends AgentConfig {
    /** AI providers to register */
    aiProviders?: Record<string, AIProvider>;
    /** Current AI provider to use */
    currentProvider?: string;
    /** Current model to use */
    currentModel?: string;
    /** Tools to register */
    tools?: BaseTool[];
    /** Plugins to register */
    plugins?: BasePlugin[];
    /** Conversation ID for centralized history management */
    conversationId?: string;
    /** Logging configuration */
    logging?: {
        level?: UtilLogLevel;
        enabled?: boolean;
    };
}

/**
 * Robota class - Main AI agent implementation
 * Integrates all managers, services, and plugin systems
 * Uses centralized conversation history management
 */
export class Robota extends BaseAgent implements AgentInterface {
    public readonly name: string;
    public readonly version: string = '1.0.0';

    // Core managers
    private aiProviders: AIProviders;
    private tools: Tools;
    private agentFactory: AgentFactory;
    private conversationHistory: ConversationHistory;
    private plugins: Plugins;

    // Core services
    private executionService: ExecutionService;

    // State management
    private config: RobotaConfig;
    private conversationId: string;
    private logger: Logger;
    private initializationPromise?: Promise<void>;
    private isFullyInitialized = false;

    constructor(config: RobotaConfig) {
        super();

        this.name = config.name || 'Robota';
        this.config = config;
        this.conversationId = config.conversationId || `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.logger = new Logger('Robota');

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

        // Initialize managers (but don't initialize them yet)
        this.aiProviders = AIProviders.getInstance();
        this.tools = Tools.getInstance();
        this.agentFactory = AgentFactory.getInstance();
        this.conversationHistory = ConversationHistory.getInstance();
        this.plugins = Plugins.getInstance();

        // Initialize services
        this.executionService = new ExecutionService(
            this.aiProviders,
            this.tools
        );

        // Register plugins
        if (config.plugins) {
            for (const plugin of config.plugins) {
                // Register with dedicated Plugins manager instead of ExecutionService
                this.plugins.register(plugin, { autoInitialize: false });
            }
        }

        this.logger.debug('Robota created (not yet initialized)', {
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
     * Ensure the agent is fully initialized (Lazy Initialization)
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
        this.logger.debug('Starting Robota initialization');

        try {
            // Initialize all managers properly
            await Promise.all([
                this.aiProviders.initialize(),
                this.tools.initialize(),
                this.agentFactory.initialize(),
                this.plugins.initialize()
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
                    this.tools.addTool(tool.schema, tool.execute.bind(tool));
                }
            }

            this.isFullyInitialized = true;
            this.logger.debug('Robota initialization completed successfully');

        } catch (error) {
            this.logger.error('Robota initialization failed', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Initialize the agent (required by BaseAgent)
     */
    protected async initialize(): Promise<void> {
        await this.ensureFullyInitialized();
    }

    /**
     * Run agent with user input
     */
    async run(input: string, options: RunOptions = {}): Promise<string> {
        // Ensure full initialization before execution
        await this.ensureFullyInitialized();

        try {
            this.logger.debug('Starting agent run', {
                inputLength: input.length,
                conversationId: this.conversationId,
                hasOptions: Object.keys(options).length > 0
            });

            // Get current conversation history
            const conversationSession = this.conversationHistory.getConversationSession(this.conversationId);
            const currentMessages = conversationSession.getMessages();

            // Use ExecutionService for actual execution
            const executionResult = await this.executionService.execute(
                input,
                currentMessages.map(msg => ({
                    role: msg.role,
                    content: msg.content,
                    timestamp: msg.timestamp,
                    metadata: msg.metadata,
                    ...(msg.role === 'assistant' && 'toolCalls' in msg ? { toolCalls: msg.toolCalls } : {}),
                    ...(msg.role === 'tool' && 'toolCallId' in msg ? { toolCallId: msg.toolCallId } : {})
                })) as Message[],
                this.config,
                {
                    conversationId: this.conversationId,
                    metadata: {
                        temperature: options.temperature,
                        maxTokens: options.maxTokens,
                        stream: options.stream
                    }
                }
            );

            this.logger.debug('Agent run completed', {
                responseLength: executionResult.response.length,
                toolsExecuted: executionResult.toolsExecuted.length,
                duration: executionResult.duration
            });

            return executionResult.response;

        } catch (error) {
            this.logger.error('Agent run failed', {
                error: error instanceof Error ? error.message : String(error),
                conversationId: this.conversationId
            });
            throw error;
        }
    }

    /**
     * Run agent in streaming mode
     */
    async* runStream(input: string, options: RunOptions = {}): AsyncGenerator<string, void, unknown> {
        // Ensure full initialization before execution
        await this.ensureFullyInitialized();

        try {
            // Get current conversation history
            const conversationSession = this.conversationHistory.getConversationSession(this.conversationId);
            const currentMessages = conversationSession.getMessages();

            // Use ExecutionService for streaming execution
            const streamGenerator = this.executionService.executeStream(
                input,
                currentMessages.map(msg => ({
                    role: msg.role,
                    content: msg.content,
                    timestamp: msg.timestamp,
                    metadata: msg.metadata,
                    ...(msg.role === 'assistant' && 'toolCalls' in msg ? { toolCalls: msg.toolCalls } : {}),
                    ...(msg.role === 'tool' && 'toolCallId' in msg ? { toolCallId: msg.toolCallId } : {})
                })) as Message[],
                this.config,
                {
                    conversationId: this.conversationId,
                    metadata: {
                        temperature: options.temperature,
                        maxTokens: options.maxTokens,
                        stream: options.stream
                    }
                }
            );

            for await (const chunk of streamGenerator) {
                yield chunk.chunk;
            }

        } catch (error) {
            this.logger.error('Streaming run failed', {
                error: error instanceof Error ? error.message : String(error),
                conversationId: this.conversationId
            });
            throw error;
        }
    }

    /**
     * Get conversation history (backwards compatible with Message[])
     */
    getHistory(): Message[] {
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
     * Clear conversation history
     */
    clearHistory(): void {
        const conversationSession = this.conversationHistory.getConversationSession(this.conversationId);
        conversationSession.clear();
        this.logger.debug('Conversation history cleared', { conversationId: this.conversationId });
    }

    /**
     * Add a plugin dynamically
     */
    addPlugin(plugin: BasePlugin): void {
        this.executionService.registerPlugin(plugin);
        this.logger.debug('Plugin added', { pluginName: plugin.name });
    }

    /**
     * Remove a plugin
     */
    removePlugin(pluginName: string): boolean {
        const removed = this.executionService.removePlugin(pluginName);
        if (removed) {
            this.logger.debug('Plugin removed', { pluginName });
        }
        return removed;
    }

    /**
     * Get a specific plugin by name
     */
    getPlugin<T extends BasePlugin = BasePlugin>(pluginName: string): T | null {
        return this.executionService.getPlugin<T>(pluginName);
    }

    /**
     * Get all registered plugins
     */
    getPlugins(): BasePlugin[] {
        return this.executionService.getPlugins();
    }

    /**
     * Get all plugin names
     */
    getPluginNames(): string[] {
        return this.executionService.getPlugins().map(plugin => plugin.name);
    }

    /**
     * Register a new AI provider
     */
    registerProvider(name: string, provider: AIProvider): void {
        this.aiProviders.addProvider(name, provider);
        this.logger.debug('AI provider registered', { providerName: name });
    }

    /**
     * Switch to a different AI provider and model
     */
    switchProvider(providerName: string, model: string): void {
        this.aiProviders.setCurrentProvider(providerName, model);
        this.config.currentProvider = providerName;
        this.config.currentModel = model;
        this.logger.debug('Switched AI provider', { provider: providerName, model });
    }

    /**
     * Register a new tool
     */
    registerTool(tool: BaseTool): void {
        this.tools.addTool(tool.schema, tool.execute.bind(tool));
        this.logger.debug('Tool registered', { toolName: tool.schema.name });
    }

    /**
     * Unregister a tool
     */
    unregisterTool(toolName: string): void {
        this.tools.removeTool(toolName);
        this.logger.debug('Tool unregistered', { toolName });
    }

    /**
     * Get current configuration
     */
    getConfig(): RobotaConfig {
        return { ...this.config };
    }

    /**
     * Update configuration
     */
    updateConfig(updates: Partial<RobotaConfig>): void {
        this.config = { ...this.config, ...updates };
        this.logger.debug('Configuration updated', { updates: Object.keys(updates) });
    }

    /**
     * Get enhanced statistics including history manager stats
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
        historyStats: any;
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
     * Validate configuration
     */
    private validateConfig(config: RobotaConfig): void {
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
     * Agent start time for uptime calculation
     */
    private startTime = Date.now();

    /**
     * Cleanup agent resources
     */
    async destroy(): Promise<void> {
        this.logger.debug('Destroying Robota instance');

        // Clear plugins first
        this.executionService.clearPlugins();

        // Dispose managers
        await this.aiProviders.dispose();
        await this.tools.dispose();

        this.logger.debug('Robota instance destroyed');
    }
} 
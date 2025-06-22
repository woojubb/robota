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
 * Each instance is completely independent with its own managers and services
 * NO GLOBAL SINGLETONS - Each Robota instance manages its own resources
 */
export class Robota extends BaseAgent implements AgentInterface {
    public readonly name: string;
    public readonly version: string = '1.0.0';

    // Instance-specific managers (NO SINGLETONS)
    private aiProviders: AIProviders;
    private tools: Tools;
    private agentFactory: AgentFactory;
    private conversationHistory: ConversationHistory;

    // Core services
    private executionService!: ExecutionService;

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
                    this.tools.addTool(tool.schema, tool.execute.bind(tool));
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
     */
    protected async initialize(): Promise<void> {
        await this.ensureFullyInitialized();
    }

    async run(input: string, options: RunOptions = {}): Promise<string> {
        await this.ensureFullyInitialized();

        try {
            this.logger.debug('Starting Robota execution', {
                inputLength: input.length,
                conversationId: this.conversationId,
                options
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
                    sessionId: options.sessionId,
                    userId: options.userId,
                    metadata: options.metadata
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

    async* runStream(input: string, options: RunOptions = {}): AsyncGenerator<string, void, unknown> {
        await this.ensureFullyInitialized();

        try {
            this.logger.debug('Starting Robota streaming execution', {
                inputLength: input.length,
                conversationId: this.conversationId,
                options
            });

            // Get current conversation history from centralized manager
            const messages = this.getHistory();

            // Prepare execution config with current provider/model settings
            const executionConfig: AgentConfig = {
                ...this.config,
                model: this.config.currentModel || this.config.model,
                provider: this.config.currentProvider || this.config.provider
            };

            // Execute using execution service streaming
            const stream = this.executionService.executeStream(
                input,
                messages,
                executionConfig,
                {
                    conversationId: this.conversationId,
                    sessionId: options.sessionId,
                    userId: options.userId,
                    metadata: options.metadata
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
     * Get conversation history
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

        // Dispose instance-specific managers
        await this.aiProviders.dispose();
        await this.tools.dispose();

        this.logger.debug('Robota instance destroyed');
    }
} 
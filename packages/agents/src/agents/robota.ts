import { BaseAgent } from '../abstracts/base-agent.js';
import { Message, AgentConfig, RunOptions, AgentInterface } from '../interfaces/agent.js';
import { BasePlugin } from '../abstracts/base-plugin.js';
import { AIProviderManager } from '../managers/ai-provider-manager.js';
import { ToolManager } from '../managers/tool-manager.js';
import { AgentFactory } from '../managers/agent-factory.js';
import { ConversationService } from '../services/conversation-service.js';
import { ToolExecutionService } from '../services/tool-execution-service.js';
import { ExecutionService } from '../services/execution-service.js';
import { AIProvider } from '../interfaces/provider.js';
import { BaseTool } from '../abstracts/base-tool.js';
import { Logger } from '../utils/logger.js';
import { ConfigurationError } from '../utils/errors.js';

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
    /** Service configurations */
    services?: {
        conversation?: any;
        toolExecution?: any;
        execution?: any;
    };
}

/**
 * Robota class - Main AI agent implementation
 * Integrates all managers, services, and plugin systems
 */
export class Robota extends BaseAgent implements AgentInterface {
    public readonly name: string;
    public readonly version: string = '1.0.0';

    // Core managers
    private aiProviderManager: AIProviderManager;
    private toolManager: ToolManager;
    private agentFactory: AgentFactory;

    // Core services
    private conversationService: ConversationService;
    private toolExecutionService: ToolExecutionService;
    private executionService: ExecutionService;

    // State management
    private config: RobotaConfig;
    private conversationHistory: Message[] = [];
    private logger: Logger;
    private initializationPromise?: Promise<void>;
    private isFullyInitialized = false;

    constructor(config: RobotaConfig) {
        super();

        this.name = config.name || 'Robota';
        this.config = config;
        this.logger = new Logger('Robota');

        // Validate configuration
        this.validateConfig(config);

        // Initialize managers (but don't initialize them yet)
        this.aiProviderManager = new AIProviderManager();
        this.toolManager = new ToolManager();
        this.agentFactory = new AgentFactory();

        // Initialize services
        this.conversationService = new ConversationService(config.services?.conversation);
        this.toolExecutionService = new ToolExecutionService(
            this.toolManager,
            config.services?.toolExecution
        );
        this.executionService = new ExecutionService(
            this.conversationService,
            this.toolExecutionService,
            this.aiProviderManager,
            this.toolManager
        );

        // Register plugins
        if (config.plugins) {
            for (const plugin of config.plugins) {
                this.executionService.registerPlugin(plugin);
            }
        }

        this.logger.info('Robota created (not yet initialized)', {
            name: this.name,
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
        this.logger.info('Starting Robota initialization');

        try {
            // Initialize all managers properly
            await Promise.all([
                this.aiProviderManager.initialize(),
                this.toolManager.initialize(),
                this.agentFactory.initialize()
            ]);

            // Register AI providers after manager initialization
            if (this.config.aiProviders) {
                for (const [name, provider] of Object.entries(this.config.aiProviders)) {
                    this.aiProviderManager.addProvider(name, provider);
                }
            }

            // Set current provider
            if (this.config.currentProvider && this.config.currentModel) {
                this.aiProviderManager.setCurrentProvider(this.config.currentProvider, this.config.currentModel);
            }

            // Register tools
            if (this.config.tools) {
                for (const tool of this.config.tools) {
                    // Convert BaseTool to ToolSchema and executor
                    this.toolManager.addTool(tool.schema, tool.execute.bind(tool));
                }
            }

            this.isFullyInitialized = true;
            this.logger.info('Robota initialization completed successfully');

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
            this.logger.info('Starting agent run', {
                inputLength: input.length,
                hasOptions: Object.keys(options).length > 0
            });

            // Use ExecutionService for actual execution
            const executionResult = await this.executionService.execute(
                input,
                this.conversationHistory,
                this.config,
                {
                    metadata: {
                        temperature: options.temperature,
                        maxTokens: options.maxTokens,
                        stream: options.stream,
                        toolChoice: options.toolChoice
                    }
                }
            );

            // Update conversation history
            this.conversationHistory = executionResult.messages;

            this.logger.info('Agent run completed', {
                responseLength: executionResult.response.length,
                toolsExecuted: executionResult.toolsExecuted.length,
                duration: executionResult.duration
            });

            return executionResult.response;

        } catch (error) {
            this.logger.error('Agent run failed', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Run agent with streaming response
     */
    async* runStream(input: string, options: RunOptions = {}): AsyncGenerator<string, void, unknown> {
        // Ensure full initialization before execution
        await this.ensureFullyInitialized();

        try {
            this.logger.info('Starting agent streaming run', {
                inputLength: input.length
            });

            // Use ExecutionService for actual streaming execution
            const streamGenerator = this.executionService.executeStream(
                input,
                this.conversationHistory,
                this.config,
                {
                    metadata: {
                        temperature: options.temperature,
                        maxTokens: options.maxTokens,
                        stream: options.stream,
                        toolChoice: options.toolChoice
                    }
                }
            );

            for await (const chunk of streamGenerator) {
                yield chunk;
            }

            this.logger.info('Agent streaming run completed', {});

        } catch (error) {
            this.logger.error('Agent streaming run failed', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get conversation history
     */
    getHistory(): Message[] {
        return [...this.conversationHistory];
    }

    /**
     * Clear conversation history
     */
    clearHistory(): void {
        this.conversationHistory = [];
        this.logger.debug('Conversation history cleared', {});
    }

    /**
     * Add a plugin dynamically
     */
    addPlugin(plugin: BasePlugin): void {
        this.executionService.registerPlugin(plugin);
        this.logger.info('Plugin added', { pluginName: plugin.name });
    }

    /**
     * Remove a plugin
     */
    removePlugin(pluginName: string): boolean {
        const removed = this.executionService.removePlugin(pluginName);
        if (removed) {
            this.logger.info('Plugin removed', { pluginName });
        }
        return removed;
    }

    /**
     * Get a plugin by name
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
     * Get plugin names
     */
    getPluginNames(): string[] {
        return this.executionService.getPlugins().map(plugin => plugin.name);
    }

    /**
     * Register an AI provider
     */
    registerProvider(name: string, provider: AIProvider): void {
        this.aiProviderManager.addProvider(name, provider);
        this.logger.info('AI provider registered', { providerName: name });
    }

    /**
     * Switch to a different AI provider
     */
    switchProvider(providerName: string, model: string): void {
        this.aiProviderManager.setCurrentProvider(providerName, model);
        this.config.model = model;
        this.config.currentModel = model;
        this.logger.info('Switched AI provider', {
            providerName,
            model
        });
    }

    /**
     * Register a tool
     */
    registerTool(tool: BaseTool): void {
        this.toolManager.addTool(tool.schema, tool.execute.bind(tool));
        this.logger.info('Tool registered', { toolName: tool.schema.name });
    }

    /**
     * Unregister a tool
     */
    unregisterTool(toolName: string): void {
        this.toolManager.removeTool(toolName);
        this.logger.info('Tool unregistered', { toolName });
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

        // Apply updates to relevant components
        if (updates.currentProvider && updates.currentModel) {
            this.aiProviderManager.setCurrentProvider(updates.currentProvider, updates.currentModel);
        }

        this.logger.info('Configuration updated', { updates: Object.keys(updates) });
    }

    /**
     * Get agent statistics
     */
    getStats(): {
        name: string;
        version: string;
        providers: string[];
        currentProvider: string | null;
        tools: string[];
        plugins: string[];
        historyLength: number;
        uptime: number;
    } {
        const current = this.aiProviderManager.getCurrentProvider();
        return {
            name: this.name,
            version: this.version,
            providers: this.aiProviderManager.getProviderNames(),
            currentProvider: current?.provider || null,
            tools: this.toolManager.getTools().map(tool => tool.name),
            plugins: this.getPluginNames(),
            historyLength: this.getHistory().length,
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
     * Cleanup resources
     */
    async destroy(): Promise<void> {
        this.logger.info('Destroying Robota instance', {});

        // Clear plugins
        this.executionService.clearPlugins();

        // Dispose managers
        await this.aiProviderManager.dispose();
        await this.toolManager.dispose();
        await this.agentFactory.dispose();

        // Clear history
        this.clearHistory();

        this.logger.info('Robota instance destroyed', {});
    }
} 
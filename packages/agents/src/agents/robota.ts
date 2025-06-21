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

    constructor(config: RobotaConfig) {
        super();

        this.name = config.name || 'Robota';
        this.config = config;
        this.logger = new Logger('Robota');

        // Validate configuration
        this.validateConfig(config);

        // Initialize managers
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

        this.logger.info('Robota initialized', {
            name: this.name,
            providersCount: Object.keys(config.aiProviders || {}).length,
            toolsCount: config.tools?.length || 0,
            pluginsCount: config.plugins?.length || 0,
            currentProvider: config.currentProvider,
            currentModel: config.currentModel || config.model
        });
    }

    /**
     * Initialize the agent (required by BaseAgent)
     */
    protected async initialize(): Promise<void> {
        // Initialize managers
        await this.aiProviderManager.initialize();
        await this.toolManager.initialize();
        await this.agentFactory.initialize();

        // Register AI providers after initialization
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

        this.logger.debug('Robota initialized successfully', {});
    }

    /**
     * Run agent with user input
     */
    async run(input: string, options: RunOptions = {}): Promise<string> {
        await this.ensureInitialized();

        try {
            this.logger.info('Starting agent run', {
                inputLength: input.length,
                hasOptions: Object.keys(options).length > 0
            });

            // Simple execution for now - just return a mock response
            // TODO: Implement actual execution through services
            const response = `Mock response for: ${input}`;

            this.logger.info('Agent run completed', {
                responseLength: response.length
            });

            return response;

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
        await this.ensureInitialized();

        try {
            this.logger.info('Starting agent streaming run', {
                inputLength: input.length
            });

            // Simple streaming for now - yield mock chunks
            // TODO: Implement actual streaming through services
            const response = `Mock streaming response for: ${input}`;
            const chunks = response.split(' ');

            for (const chunk of chunks) {
                yield chunk + ' ';
                await new Promise(resolve => setTimeout(resolve, 50)); // Simulate streaming delay
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
            plugins: [], // TODO: Get from execution service when available
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
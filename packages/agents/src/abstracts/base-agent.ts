import type { BaseAgentInterface, AgentConfig, Message, RunOptions } from '../interfaces/agent';

/**
 * Base abstract class for all agents with type parameter support
 * Provides common structure and lifecycle management
 * 
 * @template TConfig - Agent configuration type (defaults to AgentConfig for backward compatibility)
 * @template TContext - Execution context type (defaults to RunOptions for backward compatibility)
 * @template TMessage - Message type (defaults to Message for backward compatibility)
 */
export abstract class BaseAgent<
    TConfig = AgentConfig,
    TContext = RunOptions,
    TMessage = Message
> implements BaseAgentInterface<TConfig, TContext, TMessage> {
    protected history: TMessage[] = [];
    protected isInitialized = false;
    protected config?: TConfig;

    /**
     * Initialize the agent
     */
    protected abstract initialize(): Promise<void>;

    /**
     * Configure the agent with type-safe configuration
     */
    async configure(config: TConfig): Promise<void> {
        this.config = config;
        await this.ensureInitialized();
    }

    /**
     * Run agent with user input and type-safe context
     */
    abstract run(input: string, context?: TContext): Promise<string>;

    /**
     * Run agent with streaming response and type-safe context
     */
    abstract runStream(input: string, context?: TContext): AsyncGenerator<string, void, never>;

    /**
     * Get conversation history with type-safe messages
     */
    getHistory(): TMessage[] {
        return [...this.history];
    }

    /**
     * Clear conversation history
     */
    clearHistory(): void {
        this.history = [];
    }

    /**
     * Add message to history
     */
    protected addMessage(message: TMessage): void {
        this.history.push(message);
    }

    /**
     * Validate input parameters
     */
    protected validateInput(input: string): void {
        if (!input || typeof input !== 'string') {
            throw new Error('Input must be a non-empty string');
        }
    }

    /**
     * Ensure agent is initialized
     */
    protected async ensureInitialized(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
            this.isInitialized = true;
        }
    }

    /**
     * Cleanup resources
     */
    async dispose(): Promise<void> {
        this.clearHistory();
        this.isInitialized = false;
    }
} 
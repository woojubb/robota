/**
 * @fileoverview Abstract Agent Base Class
 *
 * 🎯 ABSTRACT CLASS - DO NOT DEPEND ON CONCRETE IMPLEMENTATIONS
 *
 * This class defines the foundational lifecycle for agent implementations.
 * Subclasses provide provider/tool-specific behavior while inheriting the
 * shared guarantees around initialization, history, and disposal.
 */
import type { BaseAgentInterface, AgentConfig, Message, RunOptions } from '../interfaces/agent';

export abstract class AbstractAgent<
    TConfig = AgentConfig,
    TContext = RunOptions,
    TMessage = Message
> implements BaseAgentInterface<TConfig, TContext, TMessage> {
    protected history: TMessage[] = [];
    protected isInitialized = false;
    protected config?: TConfig;

    /**
     * Initialize the agent (subclass responsibility)
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
     * Validate user input
     */
    protected validateInput(input: string): void {
        if (!input || typeof input !== 'string') {
            throw new Error('Input must be a non-empty string');
        }
    }

    /**
     * Ensure agent is initialized before running
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


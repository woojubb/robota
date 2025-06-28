import type { AgentInterface, Message, RunOptions } from '../interfaces/agent';

/**
 * Base abstract class for all agents
 * Provides common structure and lifecycle management
 */
export abstract class BaseAgent implements AgentInterface {
    protected history: Message[] = [];
    protected isInitialized = false;

    /**
     * Initialize the agent
     */
    protected abstract initialize(): Promise<void>;

    /**
     * Run agent with user input
     */
    abstract run(input: string, options?: RunOptions): Promise<string>;

    /**
     * Run agent with streaming response
     */
    abstract runStream(input: string, options?: RunOptions): AsyncGenerator<string, void, never>;

    /**
     * Get conversation history
     */
    getHistory(): Message[] {
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
    protected addMessage(message: Message): void {
        this.history.push({
            ...message,
            timestamp: message.timestamp || new Date()
        });
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
import { Robota } from '@robota-sdk/agents';
import type { AgentConfig as BaseAgentConfig } from '@robota-sdk/agents';
import { v4 as uuidv4 } from 'uuid';
import type {
    ChatInstance as IChatInstance,
    ChatConfig,
    ChatMetadata,
    ChatStats
} from './types';
import { ChatState } from './types';

/**
 * ChatInstance - Wrapper around Robota for session management
 * 
 * @description
 * A simplified wrapper around Robota instances that provides chat-specific
 * functionality within sessions. Similar to TaskAgent in the team package.
 */
export class ChatInstance implements IChatInstance {
    public readonly metadata: ChatMetadata;
    public readonly config: ChatConfig;

    private robota: Robota;
    private startTime: Date;
    private totalExecutionTime: number = 0;
    private responseCount: number = 0;
    private debug: boolean;

    /**
     * Create a ChatInstance
     */
    constructor(
        sessionId: string,
        config: ChatConfig = {},
        robotaConfig?: BaseAgentConfig,
        debug: boolean = false
    ) {
        this.config = config;
        this.debug = debug;
        this.startTime = new Date();

        // Generate unique chat ID
        const chatId = uuidv4();

        // Initialize metadata
        this.metadata = {
            chatId,
            sessionId,
            name: config.name || `Chat ${chatId.slice(0, 8)}`,
            state: ChatState.INACTIVE,
            messageCount: 0,
            isActive: false,
            createdAt: new Date(),
            lastAccessedAt: new Date(),
            updatedAt: new Date()
        };

        // Create Robota instance with provided or default configuration
        const finalRobotaConfig: BaseAgentConfig = {
            provider: 'openai',
            model: 'gpt-4',
            systemMessage: 'You are a helpful AI assistant.',
            ...robotaConfig,
            ...config.robotaConfig
        };

        this.robota = new Robota(finalRobotaConfig);

        if (this.debug) {
            console.log(`Created chat instance: ${this.metadata.name} (${chatId})`);
        }
    }

    /**
     * Execute a prompt and return the response
     */
    async run(prompt: string): Promise<string> {
        const startTime = Date.now();

        try {
            this._updateLastAccessed();
            this.metadata.messageCount++;

            if (this.debug) {
                console.log(`Chat ${this.metadata.chatId}: Running prompt`);
            }

            // Use Robota to process the prompt
            const response = await this.robota.run(prompt);

            // Update statistics
            const executionTime = Date.now() - startTime;
            this.totalExecutionTime += executionTime;
            this.responseCount++;

            if (this.debug) {
                console.log(`Chat ${this.metadata.chatId}: Response generated in ${executionTime}ms`);
            }

            return response;

        } catch (error) {
            if (this.debug) {
                console.error(`Chat ${this.metadata.chatId}: Error during execution:`, error);
            }
            throw error;
        }
    }

    /**
     * Activate this chat instance
     */
    activate(): void {
        this.metadata.state = ChatState.ACTIVE;
        this.metadata.isActive = true;
        this._updateLastAccessed();

        if (this.debug) {
            console.log(`Chat ${this.metadata.chatId}: Activated`);
        }
    }

    /**
     * Deactivate this chat instance
     */
    deactivate(): void {
        this.metadata.state = ChatState.INACTIVE;
        this.metadata.isActive = false;
        this._updateLastAccessed();

        if (this.debug) {
            console.log(`Chat ${this.metadata.chatId}: Deactivated`);
        }
    }

    /**
     * Archive this chat instance
     */
    archive(): void {
        this.metadata.state = ChatState.ARCHIVED;
        this.metadata.isActive = false;
        this._updateLastAccessed();

        if (this.debug) {
            console.log(`Chat ${this.metadata.chatId}: Archived`);
        }
    }

    /**
     * Get current chat state
     */
    getState(): ChatState {
        return this.metadata.state;
    }

    /**
     * Get chat statistics
     */
    getStats(): ChatStats {
        const averageResponseTime = this.responseCount > 0
            ? this.totalExecutionTime / this.responseCount
            : 0;

        return {
            messageCount: this.metadata.messageCount,
            executionTime: this.totalExecutionTime,
            averageResponseTime,
            tokensUsed: 0 // TODO: Implement token tracking
        };
    }

    /**
     * Destroy the chat instance and cleanup resources
     */
    async destroy(): Promise<void> {
        try {
            if (this.debug) {
                console.log(`Chat ${this.metadata.chatId}: Destroying instance`);
            }

            // Cleanup Robota instance
            await this.robota.destroy();

            // Update state
            this.metadata.state = ChatState.ARCHIVED;
            this.metadata.isActive = false;

        } catch (error) {
            if (this.debug) {
                console.error(`Chat ${this.metadata.chatId}: Error during destruction:`, error);
            }
            throw error;
        }
    }

    /**
     * Get the underlying Robota instance for advanced operations
     */
    getRobotaInstance(): Robota {
        return this.robota;
    }

    /**
     * Update last accessed timestamp
     */
    private _updateLastAccessed(): void {
        this.metadata.lastAccessedAt = new Date();
        this.metadata.updatedAt = new Date();
    }
} 
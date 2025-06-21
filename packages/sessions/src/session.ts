import { v4 as uuidv4 } from 'uuid';
import { ChatInstance } from './chat-instance';
import type { AgentConfig as BaseAgentConfig } from '@robota-sdk/agents';
import type {
    Session as ISession,
    SessionConfig,
    SessionMetadata,
    SessionStats,
    ChatConfig,
    ChatInstance as IChatInstance
} from './types';
import { SessionState } from './types';

/**
 * Session - Multi-Chat Session Management
 * 
 * @description
 * A simplified session implementation that manages multiple chat instances.
 * Similar to TeamContainer in the team package but focused on chat management.
 */
export class Session implements ISession {
    public readonly metadata: SessionMetadata;
    public readonly config: SessionConfig;

    private chats: Map<string, ChatInstance> = new Map();
    private activeChatId?: string;
    private startTime: Date;
    private totalExecutionTime: number = 0;
    private debug: boolean;

    /**
     * Create a Session instance
     */
    constructor(
        userId: string,
        config: SessionConfig = {}
    ) {
        this.config = {
            name: config.name || 'New Session',
            maxChats: config.maxChats || 10,
            debug: config.debug || false,
            ...config
        };

        this.debug = this.config.debug || false;
        this.startTime = new Date();

        // Generate unique session ID
        const sessionId = uuidv4();

        // Initialize metadata
        this.metadata = {
            sessionId,
            userId,
            name: this.config.name!,
            state: SessionState.ACTIVE,
            chatCount: 0,
            createdAt: new Date(),
            lastAccessedAt: new Date(),
            updatedAt: new Date()
        };

        if (this.debug) {
            console.log(`Created session: ${this.metadata.name} (${sessionId}) for user ${userId}`);
        }
    }

    /**
     * Create a new chat instance
     */
    async createChat(config?: ChatConfig): Promise<IChatInstance> {
        this._ensureActiveState('createChat');
        this._updateLastAccessed();

        // Check chat limit
        if (this.metadata.chatCount >= this.config.maxChats!) {
            throw new Error(`Maximum chat count (${this.config.maxChats}) reached for session ${this.metadata.sessionId}`);
        }

        // Merge with default chat config
        const finalChatConfig: ChatConfig = {
            ...this.config.defaultChatConfig,
            ...config
        };

        // Create chat instance
        const chat = new ChatInstance(
            this.metadata.sessionId,
            finalChatConfig,
            finalChatConfig.robotaConfig,
            this.debug
        );

        // Add to collection
        this.chats.set(chat.metadata.chatId, chat);
        this.metadata.chatCount++;

        // Activate first chat automatically
        if (this.metadata.chatCount === 1) {
            await this.switchToChat(chat.metadata.chatId);
        }

        if (this.debug) {
            console.log(`Session ${this.metadata.sessionId}: Created chat ${chat.metadata.chatId}`);
        }

        return chat;
    }

    /**
     * Get a specific chat by ID
     */
    getChat(chatId: string): IChatInstance | undefined {
        return this.chats.get(chatId);
    }

    /**
     * Get all chats in this session
     */
    getAllChats(): IChatInstance[] {
        return Array.from(this.chats.values());
    }

    /**
     * Remove a chat from the session
     */
    async removeChat(chatId: string): Promise<void> {
        this._ensureActiveState('removeChat');
        this._updateLastAccessed();

        const chat = this.chats.get(chatId);
        if (!chat) {
            throw new Error(`Chat ${chatId} not found in session ${this.metadata.sessionId}`);
        }

        // Destroy the chat instance
        await chat.destroy();

        // Remove from collection
        this.chats.delete(chatId);
        this.metadata.chatCount--;

        // Handle active chat reassignment
        if (this.activeChatId === chatId) {
            this.activeChatId = undefined;
            this.metadata.activeChatId = undefined;

            // Activate another chat if available
            const remainingChats = Array.from(this.chats.keys());
            if (remainingChats.length > 0) {
                await this.switchToChat(remainingChats[0]);
            }
        }

        if (this.debug) {
            console.log(`Session ${this.metadata.sessionId}: Removed chat ${chatId}`);
        }
    }

    /**
     * Switch to a different chat
     */
    async switchToChat(chatId: string): Promise<void> {
        this._ensureActiveState('switchToChat');
        this._updateLastAccessed();

        const chat = this.chats.get(chatId);
        if (!chat) {
            throw new Error(`Chat ${chatId} not found in session ${this.metadata.sessionId}`);
        }

        // Deactivate current chat
        if (this.activeChatId) {
            const currentChat = this.chats.get(this.activeChatId);
            if (currentChat) {
                currentChat.deactivate();
            }
        }

        // Activate new chat
        chat.activate();
        this.activeChatId = chatId;
        this.metadata.activeChatId = chatId;

        if (this.debug) {
            console.log(`Session ${this.metadata.sessionId}: Switched to chat ${chatId}`);
        }
    }

    /**
     * Get the currently active chat
     */
    getActiveChat(): IChatInstance | undefined {
        if (!this.activeChatId) {
            return undefined;
        }
        return this.chats.get(this.activeChatId);
    }

    /**
     * Pause the session
     */
    async pause(): Promise<void> {
        this._updateLastAccessed();
        this.metadata.state = SessionState.PAUSED;

        // Deactivate all chats
        for (const chat of this.chats.values()) {
            chat.deactivate();
        }

        if (this.debug) {
            console.log(`Session ${this.metadata.sessionId}: Paused`);
        }
    }

    /**
     * Resume the session
     */
    async resume(): Promise<void> {
        this._updateLastAccessed();
        this.metadata.state = SessionState.ACTIVE;

        // Reactivate the active chat
        if (this.activeChatId) {
            const activeChat = this.chats.get(this.activeChatId);
            if (activeChat) {
                activeChat.activate();
            }
        }

        if (this.debug) {
            console.log(`Session ${this.metadata.sessionId}: Resumed`);
        }
    }

    /**
     * Archive the session
     */
    async archive(): Promise<void> {
        this._updateLastAccessed();
        this.metadata.state = SessionState.ARCHIVED;

        // Archive all chats
        for (const chat of this.chats.values()) {
            chat.archive();
        }

        this.activeChatId = undefined;
        this.metadata.activeChatId = undefined;

        if (this.debug) {
            console.log(`Session ${this.metadata.sessionId}: Archived`);
        }
    }

    /**
     * Terminate the session
     */
    async terminate(): Promise<void> {
        this._updateLastAccessed();
        this.metadata.state = SessionState.TERMINATED;

        // Destroy all chats
        for (const chat of this.chats.values()) {
            await chat.destroy();
        }

        // Clear collections
        this.chats.clear();
        this.metadata.chatCount = 0;
        this.activeChatId = undefined;
        this.metadata.activeChatId = undefined;

        if (this.debug) {
            console.log(`Session ${this.metadata.sessionId}: Terminated`);
        }
    }

    /**
     * Get current session state
     */
    getState(): SessionState {
        return this.metadata.state;
    }

    /**
     * Get session statistics
     */
    getStats(): SessionStats {
        let totalMessages = 0;
        let totalExecutionTime = 0;
        let totalTokensUsed = 0;
        let responseCount = 0;

        // Aggregate stats from all chats
        for (const chat of this.chats.values()) {
            const chatStats = chat.getStats();
            totalMessages += chatStats.messageCount;
            totalExecutionTime += chatStats.executionTime;
            totalTokensUsed += chatStats.tokensUsed;
            responseCount += chatStats.messageCount;
        }

        const averageResponseTime = responseCount > 0
            ? totalExecutionTime / responseCount
            : 0;

        const uptime = Date.now() - this.startTime.getTime();

        return {
            totalChats: this.metadata.chatCount,
            totalMessages,
            totalExecutionTime,
            averageResponseTime,
            totalTokensUsed,
            uptime
        };
    }

    /**
     * Update last accessed timestamp
     */
    private _updateLastAccessed(): void {
        this.metadata.lastAccessedAt = new Date();
        this.metadata.updatedAt = new Date();
    }

    /**
     * Ensure session is in active state for operations
     */
    private _ensureActiveState(operation: string): void {
        if (this.metadata.state !== SessionState.ACTIVE) {
            throw new Error(`Cannot ${operation}: Session ${this.metadata.sessionId} is not active (current state: ${this.metadata.state})`);
        }
    }
} 
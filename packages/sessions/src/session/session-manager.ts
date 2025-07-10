import { Robota, AgentFactory } from '@robota-sdk/agents';
import { ChatInstance } from '../chat/chat-instance';
import type {
    SessionInfo,
    SessionManagerConfig,
    CreateSessionOptions,
    CreateChatOptions,
    ChatInfo
} from '../types/core';
import { SessionState } from '../types/core';
import type { ChatMetadata, ChatConfig } from '../types/chat';

/**
 * SessionManager - manages multiple independent AI agents in isolated workspaces
 * 
 * Core responsibilities:
 * - Create and manage multiple sessions (workspaces)
 * - Create and manage multiple chat instances (AI agents) per session
 * - Provide workspace isolation between sessions
 * - Handle basic session lifecycle and limits
 */
export class SessionManager {
    private sessions: Map<string, SessionInfo> = new Map();
    private chats: Map<string, ChatInstance> = new Map();
    private sessionChats: Map<string, Set<string>> = new Map(); // sessionId -> chatIds
    private agentFactory: AgentFactory;
    private config: Required<SessionManagerConfig>;

    constructor(config: SessionManagerConfig = {}) {
        this.config = {
            maxSessions: config.maxSessions || 50,
            maxChatsPerSession: config.maxChatsPerSession || 10,
        };

        this.agentFactory = new AgentFactory({
            maxConcurrentAgents: this.config.maxSessions * this.config.maxChatsPerSession,
        });
    }

    /**
     * Create a new session (workspace)
     */
    createSession(options: CreateSessionOptions = {}): string {
        // Simple limit check - let external code handle cleanup policy
        if (this.sessions.size >= this.config.maxSessions) {
            throw new Error(`Maximum sessions limit (${this.config.maxSessions}) reached. Please remove existing sessions before creating new ones.`);
        }

        const sessionId = this.generateSessionId();
        const sessionInfo: SessionInfo = {
            id: sessionId,
            userId: options.userId || 'anonymous',
            name: options.name || `Session ${sessionId.slice(-8)}`,
            state: SessionState.ACTIVE,
            chatCount: 0,
            createdAt: new Date(),
            lastUsedAt: new Date(),
            ...(options.workspaceId && { workspaceId: options.workspaceId }),
        };

        this.sessions.set(sessionId, sessionInfo);
        this.sessionChats.set(sessionId, new Set());

        return sessionId;
    }

    /**
     * Create a new chat (AI agent) within a session
     */
    async createChat(sessionId: string, options: CreateChatOptions): Promise<string> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        const sessionChatIds = this.sessionChats.get(sessionId)!;
        if (sessionChatIds.size >= this.config.maxChatsPerSession) {
            throw new Error(`Maximum chats per session (${this.config.maxChatsPerSession}) reached`);
        }

        const chatId = this.generateChatId();

        // Create Robota instance using AgentFactory
        const robota = await this.agentFactory.createAgent(Robota, options.agentConfig) as Robota;

        // Create chat metadata
        const metadata: ChatMetadata = {
            chatId,
            sessionId,
            chatName: options.name || `Chat ${chatId.slice(-8)}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            lastAccessedAt: new Date(),
            messageCount: 0,
            isActive: false,
            ...(options.description && { description: options.description }),
        };

        // Create chat config
        const chatConfig: ChatConfig = {
            robotaConfig: options.agentConfig,
            ...(options.name && { chatName: options.name }),
            ...(options.description && { description: options.description }),
            ...(options.agentTemplate && { agentTemplate: options.agentTemplate }),
        };

        // Create ChatInstance
        const chatInstance = new ChatInstance(metadata, chatConfig, robota);

        // Store chat
        this.chats.set(chatId, chatInstance);
        sessionChatIds.add(chatId);

        // Update session
        session.chatCount++;
        session.lastUsedAt = new Date();

        return chatId;
    }

    /**
     * Get a chat instance
     */
    getChat(chatId: string): ChatInstance | undefined {
        return this.chats.get(chatId);
    }

    /**
     * Get session information
     */
    getSession(sessionId: string): SessionInfo | undefined {
        return this.sessions.get(sessionId);
    }

    /**
     * List all chats in a session
     */
    getSessionChats(sessionId: string): ChatInfo[] {
        const chatIds = this.sessionChats.get(sessionId);
        if (!chatIds) {
            return [];
        }

        return Array.from(chatIds)
            .map(chatId => this.chats.get(chatId))
            .filter((chat): chat is ChatInstance => chat !== undefined)
            .map(chat => ({
                id: chat.metadata.chatId,
                sessionId: chat.metadata.sessionId,
                name: chat.metadata.chatName,
                isActive: chat.metadata.isActive,
                messageCount: chat.metadata.messageCount,
                createdAt: chat.metadata.createdAt,
                lastUsedAt: chat.metadata.lastAccessedAt,
                ...(chat.config.agentTemplate && { agentTemplate: chat.config.agentTemplate }),
            }));
    }

    /**
     * Switch active chat in session
     */
    switchChat(sessionId: string, chatId: string): boolean {
        const session = this.sessions.get(sessionId);
        const chat = this.chats.get(chatId);

        if (!session || !chat || chat.metadata.sessionId !== sessionId) {
            return false;
        }

        // Deactivate current active chat
        if (session.activeChatId) {
            const currentChat = this.chats.get(session.activeChatId);
            currentChat?.deactivate();
        }

        // Activate new chat
        chat.activate();
        session.activeChatId = chatId;
        session.lastUsedAt = new Date();

        return true;
    }

    /**
     * Delete a chat
     */
    deleteChat(chatId: string): boolean {
        const chat = this.chats.get(chatId);
        if (!chat) {
            return false;
        }

        const sessionId = chat.metadata.sessionId;
        const session = this.sessions.get(sessionId);
        const sessionChatIds = this.sessionChats.get(sessionId);

        if (session && sessionChatIds) {
            sessionChatIds.delete(chatId);
            session.chatCount--;

            // Clear active chat if it's the one being deleted
            if (session.activeChatId === chatId) {
                delete session.activeChatId;
            }
        }

        this.chats.delete(chatId);
        return true;
    }

    /**
     * Delete a session and all its chats
     */
    deleteSession(sessionId: string): boolean {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return false;
        }

        // Delete all chats in the session
        const chatIds = this.sessionChats.get(sessionId);
        if (chatIds) {
            for (const chatId of chatIds) {
                this.chats.delete(chatId);
            }
        }

        this.sessions.delete(sessionId);
        this.sessionChats.delete(sessionId);
        return true;
    }

    /**
     * List all sessions
     */
    listSessions(): SessionInfo[] {
        return Array.from(this.sessions.values());
    }

    /**
     * Generate unique session ID
     */
    private generateSessionId(): string {
        return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Generate unique chat ID
     */
    private generateChatId(): string {
        return `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
} 
import { randomUUID } from 'node:crypto';
import { Robota, AgentFactory } from '@robota-sdk/agent-core';
import { ChatInstance } from '../chat/chat-instance';
import type {
  ISessionInfo,
  ISessionManagerConfig,
  ICreateSessionOptions,
  ICreateChatOptions,
  IChatInfo,
} from '../types/core';
import { SessionState } from '../types/core';
import type { IChatMetadata, IChatConfig } from '../types/chat';

const DEFAULT_MAX_SESSIONS = 50;
const DEFAULT_MAX_CHATS_PER_SESSION = 10;
const SESSION_ID_SUFFIX_LENGTH = -8;

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
  private sessions: Map<string, ISessionInfo> = new Map();
  private chats: Map<string, ChatInstance> = new Map();
  private sessionChats: Map<string, Set<string>> = new Map(); // sessionId -> chatIds
  private agentFactory: AgentFactory;
  private config: Required<ISessionManagerConfig>;

  constructor(config: ISessionManagerConfig = {}) {
    this.config = {
      maxSessions: config.maxSessions || DEFAULT_MAX_SESSIONS,
      maxChatsPerSession: config.maxChatsPerSession || DEFAULT_MAX_CHATS_PER_SESSION,
    };

    this.agentFactory = new AgentFactory({
      maxConcurrentAgents: this.config.maxSessions * this.config.maxChatsPerSession,
    });
  }

  /**
   * Create a new session (workspace)
   */
  createSession(options: ICreateSessionOptions = {}): string {
    // Simple limit check - let external code handle cleanup policy
    if (this.sessions.size >= this.config.maxSessions) {
      throw new Error(
        `Maximum sessions limit (${this.config.maxSessions}) reached. Please remove existing sessions before creating new ones.`,
      );
    }

    const sessionId = this.generateSessionId();
    const sessionInfo: ISessionInfo = {
      id: sessionId,
      userId: options.userId || 'anonymous',
      name: options.name || `Session ${sessionId.slice(SESSION_ID_SUFFIX_LENGTH)}`,
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
  async createChat(sessionId: string, options: ICreateChatOptions): Promise<string> {
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
    const agent = await this.agentFactory.createAgent(Robota, options.agentConfig);
    if (!(agent instanceof Robota)) {
      throw new Error('AgentFactory did not return a Robota instance');
    }
    const robota = agent;

    // Create chat metadata
    const metadata: IChatMetadata = {
      chatId,
      sessionId,
      chatName: options.name || `Chat ${chatId.slice(SESSION_ID_SUFFIX_LENGTH)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastAccessedAt: new Date(),
      messageCount: 0,
      isActive: false,
      ...(options.description && { description: options.description }),
    };

    // Create chat config
    const chatConfig: IChatConfig = {
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
  getSession(sessionId: string): ISessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * List all chats in a session
   */
  getSessionChats(sessionId: string): IChatInfo[] {
    const chatIds = this.sessionChats.get(sessionId);
    if (!chatIds) {
      return [];
    }

    return Array.from(chatIds)
      .map((chatId) => this.chats.get(chatId))
      .filter((chat): chat is ChatInstance => chat !== undefined)
      .map((chat) => ({
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
  listSessions(): ISessionInfo[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    return `session_${randomUUID()}`;
  }

  /**
   * Generate unique chat ID
   */
  private generateChatId(): string {
    return `chat_${randomUUID()}`;
  }
}

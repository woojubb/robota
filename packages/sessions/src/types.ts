import type { AgentConfig as BaseAgentConfig, AIProvider } from '@robota-sdk/agents';

/**
 * Session state enumeration
 */
export enum SessionState {
    ACTIVE = 'active',
    PAUSED = 'paused',
    ARCHIVED = 'archived',
    TERMINATED = 'terminated'
}

/**
 * Chat state enumeration  
 */
export enum ChatState {
    ACTIVE = 'active',
    INACTIVE = 'inactive',
    ARCHIVED = 'archived'
}

/**
 * Configuration for creating a session
 */
export interface SessionConfig {
    /** Session name for identification */
    name?: string;
    /** Maximum number of chats allowed in this session */
    maxChats?: number;
    /** Default configuration for chats created in this session */
    defaultChatConfig?: ChatConfig;
    /** Debug mode for detailed logging */
    debug?: boolean;
}

/**
 * Configuration for creating a chat instance
 */
export interface ChatConfig {
    /** Chat name for identification */
    name?: string;
    /** Robota agent configuration */
    robotaConfig?: BaseAgentConfig;
}

/**
 * Session metadata
 */
export interface SessionMetadata {
    /** Unique session identifier */
    sessionId: string;
    /** User who owns this session */
    userId: string;
    /** Session name */
    name: string;
    /** Current session state */
    state: SessionState;
    /** Number of chats in this session */
    chatCount: number;
    /** Currently active chat ID */
    activeChatId?: string;
    /** Session creation timestamp */
    createdAt: Date;
    /** Last access timestamp */
    lastAccessedAt: Date;
    /** Last update timestamp */
    updatedAt: Date;
}

/**
 * Chat metadata
 */
export interface ChatMetadata {
    /** Unique chat identifier */
    chatId: string;
    /** Parent session identifier */
    sessionId: string;
    /** Chat name */
    name: string;
    /** Current chat state */
    state: ChatState;
    /** Number of messages in this chat */
    messageCount: number;
    /** Whether this chat is currently active */
    isActive: boolean;
    /** Chat creation timestamp */
    createdAt: Date;
    /** Last access timestamp */
    lastAccessedAt: Date;
    /** Last update timestamp */
    updatedAt: Date;
}

/**
 * Session statistics
 */
export interface SessionStats {
    /** Total number of chats created */
    totalChats: number;
    /** Total number of messages across all chats */
    totalMessages: number;
    /** Total execution time in milliseconds */
    totalExecutionTime: number;
    /** Average response time in milliseconds */
    averageResponseTime: number;
    /** Total tokens used */
    totalTokensUsed: number;
    /** Session uptime in milliseconds */
    uptime: number;
}

/**
 * Chat statistics
 */
export interface ChatStats {
    /** Number of messages in this chat */
    messageCount: number;
    /** Total execution time for this chat */
    executionTime: number;
    /** Average response time for this chat */
    averageResponseTime: number;
    /** Tokens used in this chat */
    tokensUsed: number;
}

/**
 * Session manager configuration
 */
export interface SessionManagerConfig {
    /** Maximum number of active sessions */
    maxActiveSessions?: number;
    /** Whether to enable automatic cleanup */
    autoCleanup?: boolean;
    /** Cleanup interval in milliseconds */
    cleanupInterval?: number;
    /** Memory threshold for cleanup in MB */
    memoryThreshold?: number;
    /** Debug mode for detailed logging */
    debug?: boolean;
}

/**
 * Session manager statistics
 */
export interface SessionManagerStats {
    /** Total number of sessions */
    totalSessions: number;
    /** Number of active sessions */
    activeSessions: number;
    /** Number of paused sessions */
    pausedSessions: number;
    /** Number of archived sessions */
    archivedSessions: number;
    /** Current memory usage in MB */
    memoryUsage: number;
}

/**
 * Session creation options for convenience function
 */
export interface SessionOptions {
    /** AI providers available for chats */
    aiProviders: Record<string, AIProvider>;
    /** Maximum number of chats per session */
    maxChats?: number;
    /** Maximum number of active sessions */
    maxActiveSessions?: number;
    /** Debug mode */
    debug?: boolean;
}

/**
 * Interface for session instances
 */
export interface Session {
    /** Session metadata */
    readonly metadata: SessionMetadata;
    /** Session configuration */
    readonly config: SessionConfig;

    // Chat management
    createChat(config?: ChatConfig): Promise<ChatInstance>;
    getChat(chatId: string): ChatInstance | undefined;
    getAllChats(): ChatInstance[];
    removeChat(chatId: string): Promise<void>;
    switchToChat(chatId: string): Promise<void>;
    getActiveChat(): ChatInstance | undefined;

    // State management
    pause(): Promise<void>;
    resume(): Promise<void>;
    archive(): Promise<void>;
    terminate(): Promise<void>;
    getState(): SessionState;

    // Statistics
    getStats(): SessionStats;
}

/**
 * Interface for chat instances
 */
export interface ChatInstance {
    /** Chat metadata */
    readonly metadata: ChatMetadata;
    /** Chat configuration */
    readonly config: ChatConfig;

    // Core functionality
    run(prompt: string): Promise<string>;

    // State management
    activate(): void;
    deactivate(): void;
    archive(): void;
    getState(): ChatState;

    // Utilities
    getStats(): ChatStats;
    destroy(): Promise<void>;
}

/**
 * Interface for session manager
 */
export interface SessionManager {
    // Session management
    createSession(userId: string, config?: SessionConfig): Promise<Session>;
    getSession(sessionId: string): Session | undefined;
    getUserSessions(userId: string): Session[];
    removeSession(sessionId: string): Promise<void>;

    // State management
    pauseSession(sessionId: string): Promise<void>;
    resumeSession(sessionId: string): Promise<void>;
    archiveSession(sessionId: string): Promise<void>;

    // Utilities
    getActiveSessionCount(): number;
    cleanup(): Promise<void>;
    shutdown(): Promise<void>;
    getStats(): SessionManagerStats;
} 
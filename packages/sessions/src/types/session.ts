import type { ChatInstance, ChatConfig } from './chat';

export enum SessionState {
    ACTIVE = 'active',
    PAUSED = 'paused',
    ARCHIVED = 'archived',
    TERMINATED = 'terminated'
}

export interface SessionConfig {
    sessionName?: string;
    description?: string;
    autoSave?: boolean;
    saveInterval?: number; // milliseconds
    maxChats?: number;
    retentionPeriod?: number; // days
}

export interface SessionMetadata {
    sessionId: string;
    userId: string;
    sessionName: string;
    description?: string;
    createdAt: Date;
    updatedAt: Date;
    lastAccessedAt: Date;
    state: SessionState;
    chatCount: number;
    activeChatId?: string;
}

export interface Session {
    readonly metadata: SessionMetadata;
    readonly config: SessionConfig;

    // Chat Management
    createNewChat(config?: ChatConfig): Promise<ChatInstance>;
    getChat(chatId: string): ChatInstance | undefined;
    getAllChats(): ChatInstance[];
    switchToChat(chatId: string): Promise<void>;
    removeChat(chatId: string): Promise<void>;
    getActiveChat(): ChatInstance | undefined;

    // Session State
    pause(): Promise<void>;
    resume(): Promise<void>;
    archive(): Promise<void>;
    terminate(): Promise<void>;

    // Lifecycle
    save(): Promise<void>;
    load(): Promise<void>;

    // Utils
    getState(): SessionState;
    updateConfig(config: Partial<SessionConfig>): void;
    getStats(): SessionStats;
}

export interface SessionStats {
    chatCount: number;
    totalMessages: number;
    memoryUsage: number; // MB
    diskUsage: number; // MB
    createdAt: Date;
    lastActivity: Date;
    uptime: number; // milliseconds
} 
import type { SessionMetadata, SessionState } from './session';
import type { ChatMetadata } from './chat';

export interface StorageConfig {
    type: 'memory' | 'file' | 'database' | 'hybrid';
    options?: StorageOptions;
}

export interface StorageOptions {
    // File storage
    dataPath?: string;
    compression?: boolean;

    // Database storage  
    connectionString?: string;
    tableName?: string;

    // Memory storage
    maxSize?: number; // MB

    // Hybrid storage
    memoryThreshold?: number; // MB
    persistentStorage?: StorageConfig;

    // Common
    encryption?: {
        enabled: boolean;
        key?: string;
        algorithm?: string;
    };
}

export interface SessionStorage {
    // Session CRUD
    saveSession(metadata: SessionMetadata): Promise<void>;
    loadSession(sessionId: string): Promise<SessionMetadata | null>;
    deleteSession(sessionId: string): Promise<void>;
    listSessions(userId?: string): Promise<SessionMetadata[]>;

    // Session State
    updateSessionState(sessionId: string, state: SessionState): Promise<void>;
    getSessionsByState(state: SessionState): Promise<SessionMetadata[]>;

    // Cleanup
    cleanup(): Promise<number>; // returns number of cleaned up sessions
    getStorageStats(): Promise<StorageStats>;
}

export interface ChatStorage {
    // Chat CRUD
    saveChat(metadata: ChatMetadata): Promise<void>;
    loadChat(chatId: string): Promise<ChatMetadata | null>;
    deleteChat(chatId: string): Promise<void>;
    listChats(sessionId: string): Promise<ChatMetadata[]>;

    // Chat Data
    saveChatData(chatId: string, data: any): Promise<void>;
    loadChatData(chatId: string): Promise<any>;
    deleteChatData(chatId: string): Promise<void>;

    // Cleanup
    cleanup(): Promise<number>;
    getStorageStats(): Promise<StorageStats>;
}

export interface UserStorage {
    // User Session Mapping
    addUserSession(userId: string, sessionId: string): Promise<void>;
    removeUserSession(userId: string, sessionId: string): Promise<void>;
    getUserSessions(userId: string): Promise<string[]>;
    getSessionUser(sessionId: string): Promise<string | null>;

    // User Management
    getUserStats(userId: string): Promise<UserStats>;
    cleanup(): Promise<number>;
}

export interface StorageManager {
    sessionStorage: SessionStorage;
    chatStorage: ChatStorage;
    userStorage: UserStorage;

    initialize(): Promise<void>;
    shutdown(): Promise<void>;
    getStats(): Promise<StorageStats>;
    cleanup(): Promise<number>;
}

export interface StorageStats {
    totalSessions: number;
    totalChats: number;
    totalUsers: number;
    memoryUsage: number; // MB
    diskUsage: number; // MB
    lastCleanup: Date;
}

export interface UserStats {
    userId: string;
    sessionCount: number;
    chatCount: number;
    totalMessages: number;
    storageUsed: number; // MB
    lastActivity: Date;
    createdAt: Date;
} 
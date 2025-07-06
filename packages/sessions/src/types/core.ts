// Re-export necessary types from agents
export type { AgentInterface, AgentConfig, Message, RunOptions } from '@robota-sdk/agents';

// Import AgentConfig type for local use
import type { AgentConfig } from '@robota-sdk/agents';

export enum SessionState {
    ACTIVE = 'active',
    PAUSED = 'paused',
    TERMINATED = 'terminated'
}

// Session related types
export interface SessionConfig {
    name?: string;
    maxChats?: number;
}

export interface SessionInfo {
    id: string;
    userId: string;
    name: string;
    state: SessionState;
    chatCount: number;
    activeChatId?: string;
    createdAt: Date;
    lastUsedAt: Date;
}

// Chat related types - using AgentConfig from agents package
export interface ChatConfig {
    name?: string;
    robotaConfig?: AgentConfig;
}

export interface ChatInfo {
    id: string;
    sessionId: string;
    name: string;
    isActive: boolean;
    messageCount: number;
    createdAt: Date;
    lastUsedAt: Date;
}

// Manager configuration
export interface SessionManagerConfig {
    maxSessions?: number;
    autoCleanupDays?: number;
} 
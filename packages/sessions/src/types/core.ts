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
    userId?: string;
    workspaceId?: string;
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
    workspaceId?: string;
}

export interface ChatInfo {
    id: string;
    sessionId: string;
    name: string;
    isActive: boolean;
    messageCount: number;
    createdAt: Date;
    lastUsedAt: Date;
    agentTemplate?: string;
}

// Manager configuration - simplified to core features only
export interface SessionManagerConfig {
    maxSessions?: number;
    maxChatsPerSession?: number;
}

// Session creation options
export interface CreateSessionOptions {
    name?: string;
    userId?: string;
    workspaceId?: string;
    maxChats?: number;
}

// Chat creation options
export interface CreateChatOptions {
    name?: string;
    agentConfig: AgentConfig;
    agentTemplate?: string;
    description?: string;
} 
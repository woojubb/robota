// Re-export necessary types from agents (SSOT)
export type { IAgent, IAgentConfig, TUniversalMessage, IRunOptions } from '@robota-sdk/agents';

// Import AgentConfig type for local use
import type { IAgentConfig } from '@robota-sdk/agents';

export enum SessionState {
    ACTIVE = 'active',
    PAUSED = 'paused',
    TERMINATED = 'terminated'
}

// Session related types
export interface ISessionConfig {
    name?: string;
    maxChats?: number;
    userId?: string;
    workspaceId?: string;
}

export interface ISessionInfo {
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

export interface IChatInfo {
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
export interface ISessionManagerConfig {
    maxSessions?: number;
    maxChatsPerSession?: number;
}

// Session creation options
export interface ICreateSessionOptions {
    name?: string;
    userId?: string;
    workspaceId?: string;
    maxChats?: number;
}

// Chat creation options
export interface ICreateChatOptions {
    name?: string;
    agentConfig: IAgentConfig;
    agentTemplate?: string;
    description?: string;
} 
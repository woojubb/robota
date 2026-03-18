// Re-export necessary types from agents (SSOT)
export type { IAgent, IAgentConfig, TUniversalMessage, IRunOptions } from '@robota-sdk/agent-core';

// Import AgentConfig type for local use
import type { IAgentConfig } from '@robota-sdk/agent-core';

/** Lifecycle state of a session. */
export enum SessionState {
  /** Session is active and accepting interactions. */
  ACTIVE = 'active',
  /** Session is temporarily paused; can be resumed. */
  PAUSED = 'paused',
  /** Session is permanently ended; no further interactions allowed. */
  TERMINATED = 'terminated',
}

/** Configuration options for creating or updating a session. */
export interface ISessionConfig {
  name?: string;
  maxChats?: number;
  userId?: string;
  workspaceId?: string;
}

/** Read-only snapshot of a session's current state and metadata. */
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

/** Read-only summary of a chat instance within a session. */
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

/** Configuration for SessionManager capacity limits. */
export interface ISessionManagerConfig {
  maxSessions?: number;
  maxChatsPerSession?: number;
}

/** Options for creating a new session via SessionManager. */
export interface ICreateSessionOptions {
  name?: string;
  userId?: string;
  workspaceId?: string;
  maxChats?: number;
}

/** Options for creating a new chat instance within a session. */
export interface ICreateChatOptions {
  name?: string;
  agentConfig: IAgentConfig;
  agentTemplate?: string;
  description?: string;
}

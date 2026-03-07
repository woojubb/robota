// Main components
export { ChatInstance } from './chat/chat-instance';
export { SessionManager } from './session/session-manager';

// Adapters
export { TemplateManagerAdapter } from './adapters/template-manager-adapter';

// Interfaces and types
export type { ITemplateManager } from './types/chat';
export type {
    IChatConfig,
    IChatMetadata,
    IChatStats
} from './types/chat';

export type {
    SessionState,
    ISessionConfig,
    ISessionInfo,
    IChatInfo,
    ISessionManagerConfig,
    ICreateSessionOptions,
    ICreateChatOptions,
    IAgent,
    IAgentConfig,
    TUniversalMessage,
    IRunOptions
} from './types/core';

// Re-export ConversationHistory from agents (unified implementation)
export { ConversationHistory, ConversationSession } from '@robota-sdk/agents'; 
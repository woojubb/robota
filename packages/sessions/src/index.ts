// Main components
export { ChatInstance } from './chat/chat-instance';
export { SessionManager } from './session/session-manager';

// Adapters
export { TemplateManagerAdapter } from './adapters/template-manager-adapter';

// Interfaces and types
export type { TemplateManager } from './types/chat';
export type {
    ChatConfig,
    ChatMetadata,
    ChatStats,
    MessageContent
} from './types/chat';

export type {
    SessionState,
    SessionConfig,
    SessionInfo,
    ChatInfo,
    SessionManagerConfig,
    CreateSessionOptions,
    CreateChatOptions,
    AgentInterface,
    AgentConfig,
    Message,
    RunOptions
} from './types/core';

// Re-export ConversationHistory from agents (unified implementation)
export { ConversationHistory, ConversationSession } from '@robota-sdk/agents'; 
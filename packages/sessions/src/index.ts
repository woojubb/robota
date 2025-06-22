// Chat instances
export { ChatInstanceImpl as ChatInstance } from './chat/chat-instance';

// Re-export ConversationHistory from agents (unified implementation)
export { ConversationHistory, ConversationSession } from '@robota-sdk/agents';

// System message management  
export { SystemMessageManagerImpl as SystemMessageManager } from './system-message/system-message-manager-impl';

// Multi-provider adapter
export { MultiProviderAdapterManager } from './provider-adapter/multi-provider-adapter-manager';

// Conversation service
export { ConversationServiceImpl as ConversationService } from './conversation/conversation-service-impl';

// Types and interfaces - core session types
export type {
    SessionConfig,
    SessionInfo,
    ChatConfig,
    ChatInfo,
    SessionManagerConfig,
    SessionState
} from './types/core';

// Chat types
export type {
    ChatInstance as ChatInstanceInterface,
    ChatMetadata,
    ChatStats,
    MessageContent
} from './types/chat';

// AI Context and Provider interfaces
export type { Context } from './interfaces/ai-context';
export type { ProviderConfig, ProviderManager } from './interfaces/ai-provider';

// Re-export necessary types from agents
export type {
    AgentInterface,
    AgentConfig,
    Message,
    RunOptions
} from '@robota-sdk/agents';

// Re-export AgentFactory from agents
export { AgentFactory } from '@robota-sdk/agents';
export type {
    TemplateApplicationResult
} from '@robota-sdk/agents';

// Storage interfaces will be added later
// SessionManager implementation will be added later 
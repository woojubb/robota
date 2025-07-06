// Chat Instance
export { ChatInstance } from './chat/chat-instance';

// Interfaces
export type { ContextManager, ConversationContext } from './interfaces/ai-context';
export type { ProviderManager, ProviderConfig } from './interfaces/ai-provider';

// Conversation Service
export { ConversationServiceImpl } from './conversation/conversation-service-impl';

// System Message Manager
export { SystemMessageManagerImpl } from './system-message/system-message-manager-impl';

// Provider Adapter
export { MultiProviderAdapterManager } from './provider-adapter/multi-provider-adapter-manager';

// Type-only exports
export type {
    AgentInterface,
    AgentConfig,
    Message,
    RunOptions,
    SessionState,
    SessionConfig,
    SessionInfo,
    ChatConfig,
    ChatInfo,
    SessionManagerConfig
} from './types/core';

export type {
    ChatInstance as IChatInstance,
    ChatMetadata,
    ChatStats,
    MessageContent,
    ConfigurationChange,
    EnhancedConversationHistory,
    TemplateManager
} from './types/chat';

// Re-export ConversationHistory from agents (unified implementation)
export { ConversationHistory, ConversationSession } from '@robota-sdk/agents';

// Re-export AgentFactory from agents
export { AgentFactory } from '@robota-sdk/agents';
export type {
    TemplateApplicationResult
} from '@robota-sdk/agents';

// Storage interfaces will be added later
// SessionManager implementation will be added later 
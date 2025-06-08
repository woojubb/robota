// Core types
export * from './types/core';

// Additional interfaces (only those not in core)
export * from './interfaces/conversation-history';
export * from './interfaces/ai-provider';
export * from './interfaces/ai-context';

// Simplified implementations
export { SimpleConversationHistory } from './conversation-history/simple-conversation-history';
export { SimpleLoggerImpl } from './utils/simple-logger';
export { SimpleMetricsCollector } from './utils/simple-metrics';
export { SimplePromptTemplate } from './utils/simple-prompt-template';
export { SessionManagerImpl } from './session-manager/session-manager-impl';
export { BasicSessionStore } from './session-manager/basic-session-store';
export { SystemMessageManagerImpl } from './system-message/system-message-manager-impl';
export { MultiProviderAdapterManager } from './provider-adapter/multi-provider-adapter-manager';
export { ConversationServiceImpl } from './conversation/conversation-service-impl';

// Utilities
export { LoggerFactory } from './utils/logger-factory';
export { MetricsCollectorFactory } from './utils/metrics-collector-factory';

// Conversation History (kept for backward compatibility)
export { ConversationHistory } from './conversation-history/conversation-history';

// Core types
export * from './types/core';

// Additional interfaces (only those not in core)
export type { Session, SessionMetadata, SessionStats } from './types/session';
export type { SessionManager, SessionManagerStats } from './types/session-manager';
export type { ChatInstance, ChatMetadata, ChatStats, MessageContent } from './types/chat';

// Simplified implementations
export { SessionImpl } from './session/session-impl';
export { ChatInstanceImpl } from './chat/chat-instance';

// State Machine
export * from './state/session-state-machine';

// Error handling
export * from './constants/error-messages';

// Utilities
export { generateId } from './utils/id';
export * from './utils/session-utils';

// Conversation History (kept for backward compatibility)
export { EnhancedConversationHistoryImpl } from './conversation-history/index';

// Storage interfaces will be added later
// SessionManager implementation will be added later 
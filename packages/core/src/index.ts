// Main Robota class
export { Robota } from './robota';
export type { RobotaOptions } from './robota';

// Interfaces
export type {
    AIProvider,
    Context,
    Message,
    MessageRole,
    ModelResponse,
    StreamingResponseChunk
} from './interfaces/ai-provider';
export type { Logger } from './interfaces/logger';

// Types
export type {
    RunOptions,
    ProviderOptions
} from './types';

// Conversation History
export {
    SimpleConversationHistory,
    PersistentSystemConversationHistory,
    isUserMessage,
    isAssistantMessage,
    isSystemMessage,
    isToolMessage
} from './conversation-history';
export type {
    ConversationHistory,
    UniversalMessage,
    UniversalMessageRole,
    UserMessage,
    AssistantMessage,
    SystemMessage,
    ToolMessage,
    BaseMessage
} from './conversation-history';

// Managers (available for direct external use when needed)
export { AIProviderManager } from './managers/ai-provider-manager';
export { ToolProviderManager } from './managers/tool-provider-manager';
export { SystemMessageManager } from './managers/system-message-manager';
export { FunctionCallManager } from './managers/function-call-manager';
export { AnalyticsManager } from './managers/analytics-manager';
export type { FunctionCallConfig, FunctionCallMode } from './managers/function-call-manager';

// Services
export { ConversationService } from './services/conversation-service';

// Utilities
export { logger } from './utils';
export { removeUndefined } from './utils';
export {
    convertUniversalToBaseMessage,
    convertUniversalToBaseMessages
} from './utils';
export type { MessageAdapter } from './utils';

// Legacy features (for backward compatibility)
export * from './providers/openai-provider'; 
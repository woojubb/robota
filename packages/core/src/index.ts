// Main Robota class
export { Robota } from './robota';
export type { RobotaOptions } from './robota';

// Interfaces and Base Classes
export type {
    AIProvider,
    Context,
    Message,
    MessageRole,
    ModelResponse,
    StreamingResponseChunk
} from './interfaces/ai-provider';
export { BaseAIProvider } from './providers/base-ai-provider';
export type { Logger } from './interfaces/logger';
export type {
    RobotaCore,
    RobotaConfigurable,
    RobotaComplete
} from './interfaces/robota-core';

// Types
export type {
    RunOptions,
    ProviderOptions,
    AgentTemplate,
    AgentConfig,
    AgentCreationConfig
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

// Agent Templates and Factory
export { AgentTemplateManager } from './managers/agent-template-manager';
export { AgentFactory } from './managers/agent-factory';

// Agent Template Validation
export {
    AgentTemplateSchema,
    AgentTemplateMetadataSchema,
    validateAgentTemplate,
    safeValidateAgentTemplate,
    getValidationErrors
} from './schemas/agent-template-schema';
export type {
    ValidatedAgentTemplate,
    ValidatedAgentTemplateMetadata
} from './schemas/agent-template-schema';

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
// OpenAI Provider is now in @robota-sdk/openai package 
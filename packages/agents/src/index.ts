// Main package exports
export * from './interfaces';
export * from './abstracts';
export * from './utils';

// Managers
export { AIProviderManager } from './managers/ai-provider-manager.js';
export { AgentFactory } from './managers/agent-factory.js';
export { ToolManager } from './managers/tool-manager.js';

// Services
export { ConversationService } from './services/conversation-service.js';
export { ExecutionService } from './services/execution-service.js';
export { ToolExecutionService } from './services/tool-execution-service.js';

// Tools (avoid name conflicts)
export { ToolRegistry } from './tools/registry/tool-registry.js';

// Provider integration exports (for openai, anthropic, google packages)
export type {
    Context,
    ModelResponse,
    StreamingResponseChunk,
    ToolSchema,
    ProviderOptions
} from './interfaces/provider.js';
export type {
    ToolCall,
    Message as UniversalMessage,
    UserMessage,
    AssistantMessage,
    SystemMessage,
    ToolMessage
} from './interfaces/agent.js';
export { BaseAIProvider } from './abstracts/base-ai-provider.js';
export { logger } from './utils/logger.js';

// Plugin exports
export * from './plugins/conversation-history';
export * from './plugins/logging';
export * from './plugins/usage';
export * from './plugins/performance';
export { ErrorHandlingPlugin, ErrorHandlingStrategy, ErrorHandlingPluginOptions } from './plugins/error-handling/index.js';

// Additional plugins
export { LimitsPlugin, LimitsStrategy, LimitsPluginOptions } from './plugins/limits-plugin.js';
export { EventEmitterPlugin, EventType, EventData, EventListener, EventEmitterPluginOptions } from './plugins/event-emitter-plugin.js';
export { WebhookPlugin, WebhookEventType, WebhookPayload, WebhookEndpoint, WebhookPluginOptions } from './plugins/webhook-plugin.js';

// Agent exports
export { Robota, RobotaConfig } from './agents/robota.js'; 
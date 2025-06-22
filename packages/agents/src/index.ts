// Main package exports
export * from './interfaces';
export * from './abstracts';
export * from './utils';

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
export * from './plugins/execution';
export { ErrorHandlingPlugin, ErrorHandlingStrategy, ErrorHandlingPluginOptions } from './plugins/error-handling/index.js';

// Additional plugins
export { LimitsPlugin, LimitsStrategy, LimitsPluginOptions } from './plugins/limits-plugin.js';
export { EventEmitterPlugin, EventType, EventData, EventListener, EventEmitterPluginOptions } from './plugins/event-emitter-plugin.js';
export { WebhookPlugin, WebhookEventType, WebhookPayload, WebhookEndpoint, WebhookPluginOptions } from './plugins/webhook-plugin.js';

// Agent exports
export { Robota, RobotaConfig } from './agents/robota.js';

// Provider exports
export { OpenAIProvider, OpenAIProviderOptions } from './providers/openai-provider.js';

// Manager exports
export { AgentFactory, AgentFactoryOptions, AgentCreationStats, AgentLifecycleEvents, TemplateApplicationResult } from './managers/agent-factory.js';

// Tool exports
export { ToolRegistry } from './tools/registry/tool-registry.js';
export { FunctionTool, createFunctionTool, createZodFunctionTool } from './tools/implementations/function-tool.js'; 
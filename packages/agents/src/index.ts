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
} from './interfaces/provider';
export type {
    ToolCall,
    UserMessage,
    AssistantMessage,
    SystemMessage,
    ToolMessage
} from './interfaces/agent';
// UniversalMessage from conversation history manager (main implementation)
export type { UniversalMessage } from './managers/conversation-history-manager';
export { BaseAIProvider } from './abstracts/base-ai-provider';
export type { ProviderExecutionConfig, ProviderExecutionResult } from './abstracts/base-ai-provider';
export { logger } from './utils/logger';

// Plugin exports
export * from './plugins/conversation-history';
export * from './plugins/logging';
export * from './plugins/usage';
export * from './plugins/performance';
export * from './plugins/execution';
export { ErrorHandlingPlugin, ErrorHandlingStrategy, ErrorHandlingPluginOptions } from './plugins/error-handling/index';

// Additional plugins
export { LimitsPlugin, LimitsStrategy, LimitsPluginOptions } from './plugins/limits-plugin';
export { EventEmitterPlugin, EventType, EventData, EventListener, EventEmitterPluginOptions } from './plugins/event-emitter-plugin';
export { WebhookPlugin, WebhookEventType, WebhookPayload, WebhookEndpoint, WebhookPluginOptions } from './plugins/webhook-plugin';

// Agent exports
export { Robota, RobotaConfig } from './agents/robota';

// NOTE: Provider implementations are no longer re-exported to prevent circular dependencies
// Import directly from provider packages:
// - OpenAIProvider from '@robota-sdk/openai'
// - AnthropicProvider from '@robota-sdk/anthropic'
// - GoogleProvider from '@robota-sdk/google'

// Manager exports
export { AgentFactory, AgentFactoryOptions, AgentCreationStats, AgentLifecycleEvents } from './managers/agent-factory';
export { AgentTemplates, TemplateApplicationResult } from './managers/agent-templates';
export { ConversationHistory, ConversationSession } from './managers/conversation-history-manager';

// Tool exports
export { ToolRegistry } from './tools/registry/tool-registry';
export { FunctionTool, createFunctionTool, createZodFunctionTool } from './tools/implementations/function-tool';

// Core types (migrated from @robota-sdk/core)
export type {
    AgentConfig,
    AgentTemplate
} from './interfaces/agent';

// Tool provider types (migrated from @robota-sdk/tools)
export type { ToolSchema as FunctionSchema } from './interfaces/provider';

// Legacy compatibility exports
export { Robota as RobotaCore } from './agents/robota';
export type { RobotaConfig as RobotaOptions } from './agents/robota'; 
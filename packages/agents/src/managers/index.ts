// Manager exports
export { AgentFactory } from './agent-factory';
export { Tools } from './tool-manager';
export { AIProviders } from './ai-provider-manager';
export { AgentTemplates, TemplateApplicationResult } from './agent-templates';
export {
    ConversationHistory,
    ConversationSession,
    type UniversalMessage,
    type UserMessage,
    type AssistantMessage,
    type SystemMessage,
    type ToolMessage,
    type MessageRole,
    type APIMessage,
    type ConversationHistoryOptions,
    createUserMessage,
    createAssistantMessage,
    createSystemMessage,
    createToolMessage,
    isAssistantMessage,
    isToolMessage,
    isSystemMessage
} from './conversation-history-manager';
export { Plugins } from './plugins';

// Plugin Types
export type { PluginsManagerInterface, PluginLifecycleEvents, PluginDependency, PluginRegistrationOptions, PluginStatus } from './plugins'; 
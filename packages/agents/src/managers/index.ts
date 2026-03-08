// Manager exports
export { AgentFactory } from './agent-factory';
export { Tools } from './tool-manager';
export { AIProviders } from './ai-provider-manager';
export { AgentTemplates, type ITemplateApplicationResult } from './agent-templates';
export {
    ConversationHistory,
    ConversationSession,
    type IProviderApiMessage,
    type IConversationHistoryOptions,
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
export type {
    IPluginsManager,
    IPluginLifecycleEvents,
    IPluginDependency,
    IPluginRegistrationOptions,
    IPluginStatus
} from './plugins';
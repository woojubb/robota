// Interface exports - centralized types first
export * from './types';

// Re-export specific types to avoid conflicts
export type {
    AgentConfig,
    AgentInterface,
    AgentTemplate,
    RunOptions
} from './agent';

// Message contracts (single source of truth)
export type {
    TUniversalMessage,
    TUniversalMessageRole,
    TUniversalMessageMetadata,
    IBaseMessage,
    IUserMessage,
    IAssistantMessage,
    ISystemMessage,
    IToolMessage,
    IToolCall
} from './messages';

export type {
    IAIProvider,
    IToolSchema,
    IParameterSchema,
    TJSONSchemaType,
    TJSONSchemaEnum,
    TParameterDefaultValue,
    IChatOptions,
    IProviderOptions,
    IProviderRequest,
    IRawProviderResponse,
    ITokenUsage,
    IProviderSpecificOptions,
    TProviderConfigValue
} from './provider';

export type {
    TAgentCreationMetadata,
    TManagerToolParameters,
    IConfigValidationResult,
    IAgentCreationOptions,
    IAgentFactory,
    IAIProviderManager,
    IToolManager
} from './manager';

export type {
    ToolInterface,
    FunctionTool,
    ToolRegistryInterface,
    ToolFactoryInterface,
    IToolResult,
    IToolExecutionResult,
    IToolExecutionContext,
    ParameterValidationResult,
    ToolExecutor,
    OpenAPIToolConfig,
    MCPToolConfig,
    TToolMetadata,
} from './tool';

export type {
    IEventService,
    IEventContext,
    IOwnerPathSegment,
    TOwnerType,
    TServiceEventType,
    IBaseEventData,
    IExecutionEventData,
    IToolEventData,
    IAgentEventData,
    IEventServiceOwnerBinding
} from './event-service';

// 🆕 Progress reporting interface exports
export type {
    ProgressReportingTool,
    ToolExecutionStep,
    ToolProgressCallback
} from './progress-reporting';

export {
    isProgressReportingTool,
    getToolEstimatedDuration,
    getToolExecutionSteps,
    setToolProgressCallback
} from './progress-reporting';

export type {
    TConversationContextMetadata,
    TToolExecutionParameters,
    TExecutionMetadata,
    TResponseMetadata,
    IToolExecutionRequest,
    IConversationContext,
    IConversationResponse,
    IStreamingChunk,
    IContextOptions,
    IExecutionServiceOptions,
    IConversationService,
    IToolExecutionService,
    IExecutionService
} from './service';

export type {
    IExecutor,
    IChatExecutionRequest,
    IStreamExecutionRequest,
    ILocalExecutorConfig,
    IRemoteExecutorConfig
} from './executor'; 
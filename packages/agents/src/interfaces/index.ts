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
    AIProvider,
    ToolSchema,
    ParameterSchema,
    JSONSchemaType,
    JSONSchemaEnum,
    ParameterDefaultValue,
    ChatOptions
} from './provider';

export type {
    AgentCreationMetadata,
    ConfigValidationResult,
    AgentFactoryInterface,
    AIProviderManagerInterface,
    ToolManagerInterface
} from './manager';

export type {
    ToolInterface,
    FunctionTool,
    ToolRegistryInterface,
    ToolFactoryInterface,
    TToolResult,
    TToolExecutionResult,
    TToolExecutionContext,
    ParameterValidationResult,
    ToolExecutor,
    OpenAPIToolConfig,
    MCPToolConfig,
    TToolMetadata,
    TToolExecutionData
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
    ConversationContextMetadata,
    ConversationContext,
    ConversationServiceInterface,
    ToolExecutionServiceInterface,
    ExecutionServiceInterface
} from './service';

export type {
    ExecutorInterface,
    ChatExecutionRequest,
    StreamExecutionRequest,
    LocalExecutorConfig,
    RemoteExecutorConfig
} from './executor'; 
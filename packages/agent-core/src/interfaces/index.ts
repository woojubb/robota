// Interface exports - centralized types first
export * from './types';

// Re-export specific types to avoid conflicts
export type { IAgentConfig, IAgentTemplate, IRunOptions } from './agent';

// Message contracts (single source of truth)
export type {
  TUniversalMessage,
  TUniversalMessageRole,
  TUniversalMessageMetadata,
  TMessageState,
  IBaseMessage,
  IUserMessage,
  IAssistantMessage,
  ISystemMessage,
  IToolMessage,
  IToolCall,
  ITextMessagePart,
  IInlineImageMessagePart,
  IUriImageMessagePart,
  TUniversalMessagePart,
} from './messages';

export type {
  IAIProvider,
  IToolSchema,
  IParameterSchema,
  TJSONSchemaKind,
  TJSONSchemaEnum,
  TParameterDefaultValue,
  IChatOptions,
  TTextDeltaCallback,
  IProviderOptions,
  IProviderRequest,
  IRawProviderResponse,
  ITokenUsage,
  IProviderSpecificOptions,
  TProviderConfigValue,
  TProviderOptionValueBase,
} from './provider';

export type {
  IMediaOutputRef,
  IProviderMediaError,
  TProviderMediaResult,
  IInlineImageInputSource,
  IUriImageInputSource,
  TImageInputSource,
  IImageGenerationRequest,
  IImageEditRequest,
  IImageComposeRequest,
  IImageGenerationResult,
  IImageGenerationProvider,
  IVideoGenerationRequest,
  IVideoJobAccepted,
  IVideoJobSnapshot,
  IVideoGenerationProvider,
} from './media-provider';

export { isImageGenerationProvider, isVideoGenerationProvider } from './media-provider';

export type {
  TAgentCreationMetadata,
  TManagerToolParameters,
  IConfigValidationResult,
  IAgentCreationOptions,
  IAgentFactory,
  IAIProviderManager,
  IToolManager,
} from './manager';

export type {
  ITool,
  IFunctionTool,
  IToolRegistry,
  IToolResult,
  IToolExecutionResult,
  IToolExecutionContext,
  IParameterValidationResult,
  TToolExecutor,
  TToolMetadata,
} from './tool';

export type { IToolFactory, IOpenAPIToolConfig, IMCPToolConfig } from './tool-integration';

export type {
  IEventService,
  IEventContext,
  IOwnerPathSegment,
  IBaseEventData,
  IExecutionEventData,
  IToolEventData,
  IAgentEventData,
  IEventServiceOwnerBinding,
  TEventListener,
} from './event-service';

// 🆕 Progress reporting interface exports
export type {
  IProgressReportingTool,
  IToolExecutionStep,
  TToolProgressCallback,
} from './progress-reporting';

export {
  isProgressReportingTool,
  getToolEstimatedDuration,
  getToolExecutionSteps,
  setToolProgressCallback,
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
  IConversationServiceOptions,
  IConversationService,
  IToolExecutionService,
  IExecutionService,
} from './service';

export type {
  IExecutor,
  IChatExecutionRequest,
  IStreamExecutionRequest,
  ILocalExecutorConfig,
  IRemoteExecutorConfig,
} from './executor';

export type {
  IEventHistoryModule,
  IEventHistoryRecord,
  IEventHistorySnapshot,
} from './history-module';

export type { ICacheKey, ICacheEntry, ICacheStorage, ICacheStats, ICacheOptions } from './cache';

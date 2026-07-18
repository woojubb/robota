// Interface exports - centralized types first
export * from './types';

// Re-export specific types to avoid conflicts
export type {
  IAgentConfig,
  IAgentTemplate,
  IRunOptions,
  TExecutionEventCallback,
  TExecutionEventData,
} from './agent';

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
  TModelEffort,
  TToolChoice,
  IProviderCapabilities,
  IProviderFunctionCallingCapability,
  IProviderNativeWebToolCapabilities,
  IProviderNativeWebToolCapability,
  IProviderNativeWebToolRequest,
  IProviderNativeRawPayloadEvent,
  TTextDeltaCallback,
  TProviderNativeRawPayload,
  TProviderNativeRawPayloadCallback,
  TProviderNativeRawPayloadKind,
  IProviderOptions,
  IProviderRequest,
  IRawProviderResponse,
  ITokenUsage,
  IProviderSpecificOptions,
  TProviderConfigValue,
  TProviderOptionValueBase,
} from './provider';
export {
  assertProviderNativeWebToolsAvailable,
  createDefaultProviderCapabilities,
  getProviderCapabilities,
} from './provider-capabilities';

export type {
  IProviderDefinitionConfig,
  IProviderCredentialRequirement,
  IProviderDefinition,
  IProviderModelCatalog,
  IProviderModelCatalogEntry,
  IProviderModelCatalogRefreshOptions,
  IProviderProbeResult,
  IProviderProfileConfig,
  IProviderProfileDefaults,
  IProviderSetupHelpLink,
  IProviderSetupStepDefinition,
  TProviderCredentialField,
  TProviderModelCapability,
  TProviderModelCatalogStatus,
  TProviderModelCatalogRefresh,
  TProviderModelLifecycle,
  TProviderSetupField,
  TProviderSetupHelpLinkKind,
} from './provider-definition';
export {
  findProviderDefinition,
  formatSupportedProviderTypes,
  getProviderCredentialRequirement,
} from './provider-definition';

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

// SELFHOST-006: per-role model routing contract (opaque-key role→fallback-chain map).
export type { IModelRef, TRoleModelMap } from './role-model';

// Interaction action contract + ask port (CMD-004) — SSOT in agent-core so command and tool sources
// both reach it.
export type {
  IActionOption,
  IActionDefault,
  IActionRequest,
  TActionResponse,
  IUserInteraction,
} from './interaction';
export {
  confirmAction,
  selectAction,
  multiSelectAction,
  textAction,
  isConfirmed,
  CONFIRM_YES,
  CONFIRM_NO,
} from './interaction-builders';

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

export type { ISpinner, ITerminalOutput } from './terminal-output';

export type { ISession } from './session';

export type { IDirent, IStats, IFileSystem, IFileSystemAsync } from './file-system';

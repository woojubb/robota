/**
 * @robota-sdk/agent-core — public API surface.
 * @packageDocumentation
 */

// Core interfaces, abstracts, utils
export * from './interfaces';
export * from './abstracts';
export * from './utils';

// Provider integration types
export type {
  IToolSchema,
  IProviderOptions,
  IChatOptions,
  TTextDeltaCallback,
  IAIProvider,
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
} from './interfaces';

export { isImageGenerationProvider, isVideoGenerationProvider } from './interfaces/media-provider';

// Message types
export type { IToolCall, IUserMessage, ISystemMessage, IToolMessage } from './interfaces/agent';
export type { TToolParameters, IToolResult, IToolExecutionContext } from './interfaces/tool';
export type {
  TUniversalMessage,
  IAssistantMessage,
  TUniversalMessageMetadata,
  ITextMessagePart,
  IInlineImageMessagePart,
  IUriImageMessagePart,
  TUniversalMessagePart,
} from './interfaces/messages';

// Message type guards and utilities
export {
  isUserMessage,
  isAssistantMessage,
  isSystemMessage,
  isToolMessage,
  isChatEntry,
  chatEntryToMessage,
  messageToHistoryEntry,
  getMessagesForAPI,
} from './interfaces/messages';

export type { IHistoryEntry } from './interfaces/messages';

// Message factories (inline re-export avoids rollup-plugin-dts conflicts)
export {
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  createToolMessage,
} from './managers/conversation-history-manager';

// Provider types
export type { IProviderRequest, IRawProviderResponse } from './interfaces/provider';
export { AbstractAIProvider } from './abstracts/abstract-ai-provider';

// Executors
export { LocalExecutor, type IAIProviderInstance } from './executors/local-executor';
export { AbstractExecutor } from './abstracts/abstract-executor';
export type {
  IExecutor,
  IChatExecutionRequest,
  IStreamExecutionRequest,
  ILocalExecutorConfig,
  IRemoteExecutorConfig,
} from './interfaces/executor';

// Logger
export { logger, SilentLogger, createLogger, type ILogger } from './utils/logger';

// Plugin system
export {
  EventEmitterPlugin,
  type TEventName,
  type IEventEmitterEventData,
  type TEventEmitterListener,
  type IEventEmitterPluginOptions,
  type IEventEmitterHierarchicalEventData,
} from './plugins/event-emitter-plugin';

// Core agent
export { Robota } from './core/robota';

// Managers
export {
  AgentFactory,
  type IAgentFactoryOptions,
  type IAgentCreationStats,
  type IAgentLifecycleEvents,
} from './managers/agent-factory';
export { AgentTemplates, type ITemplateApplicationResult } from './managers/agent-templates';
export { ConversationHistory, ConversationStore } from './managers/conversation-history-manager';

// Core types
export type { IAgent, IAgentConfig, IAgentTemplate, IRunOptions } from './interfaces/agent';

// Event history module
export type {
  IEventHistoryModule,
  IEventHistoryRecord,
  IEventHistorySnapshot,
} from './interfaces/history-module';
export { EventHistoryModule } from './services/history-module';

// Event emitter (plugin)
export { EVENT_EMITTER_EVENTS } from './plugins/event-emitter/types';
export type { IEventEmitterPlugin, TExecutionEventName } from './plugins/event-emitter/types';
export { InMemoryEventEmitterMetrics } from './plugins/event-emitter/metrics';
export type {
  IEventEmitterMetrics,
  IEventEmitterMetricsSnapshot,
} from './plugins/event-emitter/metrics';

// Event service
export type {
  TEventExtensionValue,
  TEventUniversalValue,
  TEventLoggerData,
  IEventObjectValue,
} from './event-service/interfaces';
export {
  AbstractEventService,
  DEFAULT_ABSTRACT_EVENT_SERVICE,
  isDefaultEventService,
  bindEventServiceOwner,
  bindWithOwnerPath,
  DefaultEventService,
  StructuredEventService,
  ObservableEventService,
  composeEventName,
} from './event-service/event-service';
export { TASK_EVENTS, TASK_EVENT_PREFIX } from './event-service/task-events';
export { USER_EVENTS, USER_EVENT_PREFIX } from './event-service/user-events';
export type { TUserEvent } from './event-service/user-events';

// Event constants (SSOT — do not hardcode strings)
export { EXECUTION_EVENTS, EXECUTION_EVENT_PREFIX } from './services/execution-service';
export { TOOL_EVENTS, TOOL_EVENT_PREFIX } from './services/tool-execution-service';
export { AGENT_EVENTS, AGENT_EVENT_PREFIX } from './agents/constants';

// Workflow converter interfaces
export type {
  IWorkflowConverter,
  IWorkflowConversionOptions,
  IWorkflowConversionResult,
  IWorkflowData,
  IWorkflowConfig,
  IWorkflowMetadata,
} from './interfaces/workflow-converter';
export type {
  IWorkflowValidator,
  IValidationOptions,
  IValidationResult,
  IValidationIssue,
  ValidationSeverity,
} from './interfaces/workflow-validator';

// Execution proxy
export { ExecutionProxy, createExecutionProxy, withEventEmission } from './utils/execution-proxy';

// Permissions
export type {
  TPermissionMode,
  TTrustLevel,
  TPermissionDecision,
  TToolArgs,
  IPermissionLists,
  TKnownToolName,
} from './permissions/index.js';
export {
  TRUST_TO_MODE,
  evaluatePermission,
  MODE_POLICY,
  UNKNOWN_TOOL_FALLBACK,
} from './permissions/index.js';

// Context window tracking
export type { IContextTokenUsage, IContextWindowState } from './context/index.js';
export type { IModelDefinition } from './context/index.js';
export {
  CLAUDE_MODELS,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_OUTPUT,
  getModelContextWindow,
  getModelMaxOutput,
  getModelName,
  formatTokenCount,
} from './context/index.js';

// Hooks
export type {
  THookEvent,
  THooksConfig,
  IHookGroup,
  ICommandHookDefinition,
  IHttpHookDefinition,
  IPromptHookDefinition,
  IAgentHookDefinition,
  IHookDefinition,
  IHookInput,
  IHookResult,
  IHookTypeExecutor,
} from './hooks/index.js';
export { runHooks } from './hooks/index.js';

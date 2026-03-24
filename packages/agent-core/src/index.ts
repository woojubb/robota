/**
 * @fileoverview Robota SDK Agents Package - Comprehensive AI Agent Framework
 *
 * 🎯 Centralized node type management: domain-neutral workflow node type system
 *
 * The `@robota-sdk/agent-core` package provides a complete AI agent framework with support for
 * multiple AI providers, tool calling, plugin systems, and streaming responses. This package
 * provides a modern, modular architecture for building powerful AI applications.
 *
 * ## Key Features
 *
 * - **Multi-Provider Support**: OpenAI, Anthropic, Google, and custom AI providers
 * - **Tool Calling**: Zod-based schema validation for function calls
 * - **Plugin System**: Extensible lifecycle hooks for logging, analytics, error handling
 * - **Streaming Responses**: Real-time response streaming from all providers
 * - **Conversation Management**: Centralized history and session management
 * - **Type Safety**: Full TypeScript support with strict type checking
 * - **Modular Architecture**: Independent packages with clear separation of concerns
 *
 * ## Quick Start
 *
 * ```typescript
 * import { Robota } from '@robota-sdk/agent-core';
 * import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';
 *
 * const robota = new Robota({
 *   name: 'MyAgent',
 *   aiProviders: {
 *     openai: new OpenAIProvider({ apiKey: 'sk-...' })
 *   },
 *   currentProvider: 'openai',
 *   currentModel: 'gpt-4'
 * });
 *
 * const response = await robota.run('Hello, world!');
 * console.log(response);
 * ```
 *
 * ## Package Structure
 *
 * - **Core Agent**: `Robota` class for AI conversations
 * - **Abstracts**: Base classes for extending functionality
 * - **Interfaces**: TypeScript definitions for all components
 * - **Plugins**: Extensible functionality (8+ built-in plugins)
 * - **Tools**: Function calling and tool management
 * - **Managers**: Resource and state management
 * - **Utils**: Logging, error handling, validation utilities
 *
 * @public
 * @packageDocumentation
 */

// ===== CORE INTERFACES AND ABSTRACTS =====
/**
 * Core interfaces defining the structure and contracts for all components.
 * These provide type safety and enable extensibility throughout the framework.
 *
 * @public
 */
export * from './interfaces';

/**
 * 🎯 Centralized node type system (prevents arbitrary external custom node types)
 *
 * Provides domain-neutral, consistent workflow node types.
 * Prevents external code from creating arbitrary node types and
 * centralizes all node types through these constants.
 *
 * @public
 */

/**
 * Abstract base classes that provide common functionality and structure.
 * Extend these classes to create custom agents, tools, plugins, and providers.
 *
 * @public
 */
export * from './abstracts';

/**
 * Utility functions for logging, error handling, validation, and other common tasks.
 * These utilities ensure consistent behavior across all components.
 *
 * @public
 */
export * from './utils';

// ===== PROVIDER INTEGRATION EXPORTS =====
/**
 * Type definitions for AI provider integration.
 * Used by OpenAI, Anthropic, Google, and custom provider packages.
 *
 * @public
 */
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

/**
 * Message type definitions for conversation management.
 * Supports all message types including tool calls and responses.
 *
 * @public
 */
export type { IToolCall, IUserMessage, ISystemMessage, IToolMessage } from './interfaces/agent';

/**
 * Tool contract types used across tools and integrations.
 *
 * @public
 */
export type { TToolParameters, IToolResult, IToolExecutionContext } from './interfaces/tool';

/**
 * Universal message format and assistant message used internally by the conversation history manager.
 * Provides a common format that can be converted to/from provider-specific formats.
 *
 * @public
 */
export type {
  TUniversalMessage,
  IAssistantMessage,
  TUniversalMessageMetadata,
  ITextMessagePart,
  IInlineImageMessagePart,
  IUriImageMessagePart,
  TUniversalMessagePart,
} from './interfaces/messages';

/**
 * Type guards for the canonical TUniversalMessage union.
 *
 * @public
 */
export {
  isUserMessage,
  isAssistantMessage,
  isSystemMessage,
  isToolMessage,
} from './interfaces/messages';

/**
 * Message factory functions for creating typed conversation messages.
 * Inline re-export avoids rollup-plugin-dts conflicts from duplicate symbol names.
 *
 * @public
 */
export {
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  createToolMessage,
} from './managers/conversation-history-manager';

/**
 * Provider request/response types (raw provider boundary).
 *
 * @public
 */
export type { IProviderRequest, IRawProviderResponse } from './interfaces/provider';

/**
 * Abstract AI provider implementation that all AI providers must extend.
 * Provides common functionality for message conversion, error handling, and execution.
 *
 * @public
 */
export { AbstractAIProvider } from './abstracts/abstract-ai-provider';

/**
 * Executor implementations for local and remote AI provider execution
 *
 * @public
 */
export { LocalExecutor, type IAIProviderInstance } from './executors/local-executor';
export { AbstractExecutor } from './abstracts/abstract-executor';

// Export executor interfaces
export type {
  IExecutor,
  IChatExecutionRequest,
  IStreamExecutionRequest,
  ILocalExecutorConfig,
  IRemoteExecutorConfig,
} from './interfaces/executor';

/**
 * Centralized logger instance with configurable levels and output targets.
 * Use this for consistent logging across all components.
 *
 * @public
 */
export { logger, SilentLogger, createLogger, type ILogger } from './utils/logger';

// ===== PLUGIN SYSTEM EXPORTS =====
/**
 * EventEmitterPlugin and related types.
 * The plugin implementation for event-driven communication between plugins.
 *
 * NOTE: ConversationHistoryPlugin, LoggingPlugin, UsagePlugin, PerformancePlugin,
 * ExecutionAnalyticsPlugin, ErrorHandlingPlugin, LimitsPlugin, WebhookPlugin have been
 * moved to their own packages (@robota-sdk/plugin-*).
 *
 * @public
 */
export {
  EventEmitterPlugin,
  type TEventName,
  type IEventEmitterEventData,
  type TEventEmitterListener,
  type IEventEmitterPluginOptions,
  type IEventEmitterHierarchicalEventData,
} from './plugins/event-emitter-plugin';

// ===== CORE AGENT EXPORTS =====
/**
 * The Robota agent class.
 * This is the primary entry point for creating AI agents.
 *
 * @example Basic Usage
 * ```typescript
 * import { Robota, type TAgentConfig } from '@robota-sdk/agent-core';
 *
 * const config: AgentConfig = {
 *   name: 'Assistant',
 *   aiProviders: [provider],
 *   defaultModel: {
 *     provider: 'openai',
 *     model: 'gpt-4'
 *   }
 * };
 *
 * const agent = new Robota(config);
 * ```
 *
 * @public
 */
export { Robota } from './core/robota';

// ===== PROVIDER COMPATIBILITY NOTICE =====
/**
 * **Important**: Provider implementations are no longer re-exported to prevent circular dependencies.
 *
 * Import AI providers directly from their respective packages:
 * - `OpenAIProvider` from `@robota-sdk/agent-provider-openai`
 * - `AnthropicProvider` from `@robota-sdk/agent-provider-anthropic`
 * - `GoogleProvider` from `@robota-sdk/agent-provider-google`
 *
 * @example
 * ```typescript
 * import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';
 * import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
 * import { GoogleProvider } from '@robota-sdk/agent-provider-google';
 * ```
 */

// ===== MANAGER EXPORTS =====
/**
 * Resource and state management components for agent lifecycle.
 * These managers handle creation, configuration, and coordination of agent resources.
 *
 * @public
 */
export {
  AgentFactory,
  type IAgentFactoryOptions,
  type IAgentCreationStats,
  type IAgentLifecycleEvents,
} from './managers/agent-factory';
export { AgentTemplates, type ITemplateApplicationResult } from './managers/agent-templates';
export { ConversationHistory, ConversationSession } from './managers/conversation-history-manager';

// ===== TOOL SYSTEM EXPORTS =====
// NOTE: ToolRegistry, FunctionTool, createFunctionTool, createZodFunctionTool, OpenAPITool
// have been moved to @robota-sdk/agent-tools.
// NOTE: MCPTool, RelayMcpTool have been moved to @robota-sdk/agent-tool-mcp.

// ===== CORE TYPE EXPORTS =====
/**
 * Core type definitions for agent configuration and templates.
 * These types provide modern TypeScript support for agent creation.
 *
 * @public
 */
export type { IAgent, IAgentConfig, IAgentTemplate, IRunOptions } from './interfaces/agent';

/**
 * Event history module contracts (optional service).
 *
 * @public
 */
export type {
  IEventHistoryModule,
  IEventHistoryRecord,
  IEventHistorySnapshot,
} from './interfaces/history-module';
export { EventHistoryModule } from './services/history-module';

// NOTE: RelayMcpTool, IRelayMcpOptions, IRelayMcpContext moved to @robota-sdk/agent-tool-mcp

// ===== EVENT EMITTER (PLUGIN) EXPORTS =====
export { EVENT_EMITTER_EVENTS } from './plugins/event-emitter/types';
export type { IEventEmitterPlugin, TExecutionEventName } from './plugins/event-emitter/types';
export { InMemoryEventEmitterMetrics } from './plugins/event-emitter/metrics';
export type {
  IEventEmitterMetrics,
  IEventEmitterMetricsSnapshot,
} from './plugins/event-emitter/metrics';

// ===== EVENT CONSTANT EXPORTS (PUBLIC) =====
// NOTE: These are the single source of truth for event names. Do not hardcode strings.
export { EXECUTION_EVENTS, EXECUTION_EVENT_PREFIX } from './services/execution-service';
export { TOOL_EVENTS, TOOL_EVENT_PREFIX } from './services/tool-execution-service';
export { AGENT_EVENTS, AGENT_EVENT_PREFIX } from './agents/constants';

// NOTE: Workflow builder/converter/visualization utilities were removed from @robota-sdk/agent-core.
// Keep workflow concerns outside of the agents package to avoid cross-domain coupling.

// Workflow Converter Interfaces
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

// NOTE: Universal workflow conversion/validation/layout/visualization exports were removed from @robota-sdk/agent-core.
// Keep workflow concerns outside of the agents package to avoid cross-domain coupling.

// EventServiceHookFactory removed - simplified architecture
export { ExecutionProxy, createExecutionProxy, withEventEmission } from './utils/execution-proxy';

// ExecutionHierarchyTracker removed

// ================================
// Real-Time System (Phase 3)
// ================================

// Real-Time React-Flow Generator - MOVED to apps/web/src/lib/workflow-visualization
// These exports have been moved to maintain clean architecture separation

// Real-Time Event Integration - MOVED to apps/web due to React-Flow dependencies

// Performance Optimizer - MOVED to apps/web/src/lib/workflow-visualization
// These exports have been moved to maintain clean architecture separation

// Real-Time System Integration Test - MOVED to apps/web due to React-Flow dependencies

// ===== PERMISSIONS MODULE =====
/**
 * Permission system — Claude Code compatible permission evaluation.
 *
 * @public
 */
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

// ===== CONTEXT WINDOW TRACKING =====
/**
 * Context window tracking types — token usage and context state.
 *
 * @public
 */
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

// ===== HOOKS MODULE =====
/**
 * Hook system — Claude Code compatible lifecycle hooks.
 *
 * @public
 */
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

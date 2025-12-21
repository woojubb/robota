/**
 * @fileoverview Robota SDK Agents Package - Comprehensive AI Agent Framework
 * 
 * 🎯 중앙집중 Node Type 관리 추가: 도메인 중립적 워크플로우 노드 타입 시스템
 * 
 * The `@robota-sdk/agents` package provides a complete AI agent framework with support for
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
 * import { Robota } from '@robota-sdk/agents';
 * import { OpenAIProvider } from '@robota-sdk/openai';
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
 * 🎯 중앙집중 Node Type 시스템 (외부 커스텀 타입 생성 방지)
 * 
 * 도메인 중립적이고 일관된 워크플로우 노드 타입을 제공합니다.
 * 외부에서 임의의 Node 타입을 생성하는 것을 방지하고,
 * 모든 Node 타입을 이 상수들을 통해 관리합니다.
 * 
 * @public
 */
export * from './constants/workflow-node-types';

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
    ToolSchema,
    ProviderOptions
} from './interfaces/provider';

/**
 * Message type definitions for conversation management.
 * Supports all message types including tool calls and responses.
 * 
 * @public
 */
export type {
    IToolCall,
    IUserMessage,
    ISystemMessage,
    IToolMessage,
} from './interfaces/agent';

/**
 * Tool contract types used across tools and integrations.
 *
 * @public
 */
export type { TToolParameters, ToolResult, ToolExecutionContext } from './interfaces/tool';

/**
 * Universal message format and assistant message used internally by the conversation history manager.
 * Provides a common format that can be converted to/from provider-specific formats.
 * 
 * @public
 */
export type {
    TUniversalMessage,
    IAssistantMessage,
    TUniversalMessageMetadata
} from './managers/conversation-history-manager';

/**
 * Type guards for the canonical TUniversalMessage union.
 *
 * @public
 */
export {
    isUserMessage,
    isAssistantMessage,
    isSystemMessage,
    isToolMessage
} from './managers/conversation-history-manager';

/**
 * Provider request/response types (raw provider boundary).
 *
 * @public
 */
export type { ProviderRequest, RawProviderResponse } from './interfaces/provider';

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
export { LocalExecutor, type AIProviderInstance } from './executors/local-executor';
export { AbstractExecutor } from './abstracts/abstract-executor';

// Export executor interfaces
export type {
    ExecutorInterface,
    ChatExecutionRequest,
    StreamExecutionRequest,
    LocalExecutorConfig,
    RemoteExecutorConfig
} from './interfaces/executor';



/**
 * Centralized logger instance with configurable levels and output targets.
 * Use this for consistent logging across all components.
 * 
 * @public
 */
export { logger } from './utils/logger';

/**
 * Simple logger interface and implementations for browser compatibility.
 * Used across all packages for consistent logging behavior.
 * 
 * @public
 */
export {
    SimpleLogger,
    SilentLogger,
    DefaultConsoleLogger,
    StderrLogger
} from './utils/simple-logger';

export { AbstractLogger } from './utils/abstract-logger';

// ===== PLUGIN SYSTEM EXPORTS =====
/**
 * Core plugins providing essential functionality through lifecycle hooks.
 * These plugins can be combined to create powerful, extensible agent behaviors.
 * 
 * ## Available Plugins:
 * - **ConversationHistoryPlugin**: Persistent conversation storage
 * - **LoggingPlugin**: Configurable logging with multiple strategies
 * - **UsagePlugin**: Token usage and cost tracking
 * - **PerformancePlugin**: Performance metrics and monitoring
 * - **ExecutionPlugin**: Execution analytics and insights
 * - **ErrorHandlingPlugin**: Error recovery and retry logic
 * - **LimitsPlugin**: Rate limiting and resource control
 * - **EventEmitterPlugin**: Event-driven plugin communication
 * - **WebhookPlugin**: External system notifications
 * 
 * @public
 */
export * from './plugins/conversation-history';
export * from './plugins/logging';
export * from './plugins/usage';
export * from './plugins/performance';
export * from './plugins/execution';
export { ErrorHandlingPlugin, ErrorHandlingStrategy, ErrorHandlingPluginOptions } from './plugins/error-handling/index';

/**
 * Additional specialized plugins for advanced use cases.
 * 
 * @public
 */
export { LimitsPlugin, LimitsStrategy, LimitsPluginOptions } from './plugins/limits-plugin';
export { EventEmitterPlugin, EventType, EventData, EventListener, EventEmitterPluginOptions, HierarchicalEventData } from './plugins/event-emitter-plugin';
export { WebhookPlugin, WebhookEventType, WebhookPayload, WebhookEndpoint, WebhookPluginOptions } from './plugins/webhook';

// ===== CORE AGENT EXPORTS =====
/**
 * The Robota agent class.
 * This is the primary entry point for creating AI agents.
 * 
 * @example Basic Usage
 * ```typescript
 * import { Robota, type AgentConfig } from '@robota-sdk/agents';
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

// Agent event constants (public API) - used by workflow handlers
export { AGENT_EVENTS } from './agents/constants';

// ===== PROVIDER COMPATIBILITY NOTICE =====
/**
 * **Important**: Provider implementations are no longer re-exported to prevent circular dependencies.
 * 
 * Import AI providers directly from their respective packages:
 * - `OpenAIProvider` from `@robota-sdk/openai`
 * - `AnthropicProvider` from `@robota-sdk/anthropic`
 * - `GoogleProvider` from `@robota-sdk/google`
 * 
 * @example
 * ```typescript
 * import { OpenAIProvider } from '@robota-sdk/openai';
 * import { AnthropicProvider } from '@robota-sdk/anthropic';
 * import { GoogleProvider } from '@robota-sdk/google';
 * ```
 */

// ===== MANAGER EXPORTS =====
/**
 * Resource and state management components for agent lifecycle.
 * These managers handle creation, configuration, and coordination of agent resources.
 * 
 * @public
 */
export { AgentFactory, AgentFactoryOptions, AgentCreationStats, AgentLifecycleEvents } from './managers/agent-factory';
export { AgentTemplates, TemplateApplicationResult } from './managers/agent-templates';
export { ConversationHistory, ConversationSession } from './managers/conversation-history-manager';

// ===== TOOL SYSTEM EXPORTS =====
/**
 * Tool management and function calling infrastructure.
 * Provides schema-based validation and execution for AI tool calls.
 * 
 * @public
 */
export { ToolRegistry } from './tools/registry/tool-registry';
export { FunctionTool, createFunctionTool, createZodFunctionTool } from './tools/implementations/function-tool';

// ===== CORE TYPE EXPORTS =====
/**
 * Core type definitions for agent configuration and templates.
 * These types provide modern TypeScript support for agent creation.
 * 
 * @public
 */
export type {
    AgentConfig,
    AgentTemplate
} from './interfaces/agent';

/**
 * Tool provider types for function calling integration.
 * Provides type safety for tool implementations and schema validation.
 * 
 * @public
 */
export type { ToolSchema as FunctionSchema } from './interfaces/provider';

// ===== EVENT SERVICE EXPORTS =====
/**
 * EventService - Unified event emission system for Team/Agent/Tool integration.
 * Provides single event handler architecture for complete execution tracking.
 * 
 * @public
 */
export {
    EventService,
    ServiceEventType,
    ServiceEventData,
    EventContext,
    OwnerPathSegment,
    AbstractEventService,
    DEFAULT_ABSTRACT_EVENT_SERVICE,
    isDefaultEventService,
    bindEventServiceOwner,
    bindWithOwnerPath,
    DefaultEventService,
    StructuredEventService,
} from './services/event-service';
export { RelayMcpTool, type RelayMcpOptions, type RelayMcpContext } from './tools/implementations/relay-mcp-tool';

// ===== EVENT EMITTER (PLUGIN) EXPORTS =====
export { EVENT_EMITTER_EVENTS } from './plugins/event-emitter/types';

// ===== EVENT CONSTANT EXPORTS (PUBLIC) =====
// NOTE: These are the single source of truth for event names. Do not hardcode strings.
export { EXECUTION_EVENTS } from './services/execution-service';
export { TOOL_EVENTS } from './services/tool-execution-service';

// NOTE: Workflow builder/converter/visualization utilities were removed from @robota-sdk/agents.
// Ownership is @robota-sdk/workflow. Agents must not depend on workflow to avoid circular package dependencies.

// Workflow Converter Interfaces
export type {
    WorkflowConverterInterface,
    WorkflowConversionOptions,
    WorkflowConversionResult,
    WorkflowData
} from './interfaces/workflow-converter';

export type {
    WorkflowValidatorInterface,
    ValidationOptions,
    ValidationResult,
    ValidationIssue,
    ValidationSeverity
} from './interfaces/workflow-validator';

// NOTE: Universal workflow conversion/validation/layout/visualization exports were removed from @robota-sdk/agents.
// Ownership is @robota-sdk/workflow. Agents must not depend on workflow to avoid circular package dependencies.

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


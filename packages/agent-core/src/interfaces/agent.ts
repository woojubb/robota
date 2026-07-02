import type { ICacheOptions } from './cache';
import type { IUserInteraction } from './interaction';
import type { TUniversalMessageMetadata, TUniversalMessage } from './messages';
import type {
  TProviderConfigValue,
  IAIProvider,
  TTextDeltaCallback,
  TModelEffort,
} from './provider';
import type { TMetadata, TConfigValue } from './types';
import type { IModule } from '../abstracts/abstract-module';
import type { IPluginContract, IPluginOptions, IPluginStats } from '../abstracts/abstract-plugin';
import type { IToolWithEventService } from '../abstracts/abstract-tool';
import type { IEventService, IOwnerPathSegment } from '../interfaces/event-service';
import type { TStructuredOutputSchema } from '../schema/structured-output';
import type { TUtilLogLevel } from '../utils/logger';

export type {
  TUniversalMessage,
  TUniversalMessageMetadata,
  IBaseMessage,
  IUserMessage,
  IAssistantMessage,
  ISystemMessage,
  IToolMessage,
  IToolCall,
  TUniversalMessageRole,
} from './messages';

/**
 * IExecutionContextInjection
 *
 * Minimal context payload used to inject an existing ownerPath into a new agent instance
 * (e.g., when a tool creates an agent and must preserve absolute ownerPath semantics).
 *
 * NOTE: This is intentionally NOT ToolExecutionContext. ToolExecutionContext is for tool calls
 * and requires toolName/parameters; agent creation only needs ownerPath and execution linkage.
 */
export interface IExecutionContextInjection {
  ownerPath?: IOwnerPathSegment[];
  parentExecutionId?: string;
  rootExecutionId?: string;
  executionLevel?: number;
  sourceId?: string;
}

// Provider config value types are owned by provider axis (`interfaces/provider.ts`).

/**
 * Provider-specific configuration
 */
export interface IAgentProviderConfig {
  openai?: {
    apiKey?: string;
    baseURL?: string;
    organization?: string;
    [key: string]: TProviderConfigValue | undefined;
  };
  anthropic?: {
    apiKey?: string;
    baseURL?: string;
    [key: string]: TProviderConfigValue | undefined;
  };
  google?: {
    apiKey?: string;
    projectId?: string;
    location?: string;
    [key: string]: TProviderConfigValue | undefined;
  };
  [provider: string]: Record<string, TProviderConfigValue | undefined> | undefined;
}

/**
 * Agent configuration options - New design with aiProviders array and defaultModel
 */
export interface IAgentConfig {
  id?: string;
  name: string;
  aiProviders: IAIProvider[];
  defaultModel: {
    provider: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    /** Reasoning-effort dial threaded to the provider request builder per call. */
    effort?: TModelEffort;
  };

  // Tools and plugins
  tools?: Array<IToolWithEventService>;
  plugins?: Array<IPluginContract<IPluginOptions, IPluginStats>>;

  // Modules for extended functionality
  modules?: IModule[];

  // System configuration
  systemMessage?: string;
  systemPrompt?: string;

  // Conversation management
  conversationId?: string;
  sessionId?: string;
  userId?: string;

  // Metadata and context
  metadata?: TUniversalMessageMetadata;
  context?: Record<string, TConfigValue>;

  // Logging configuration
  logging?: {
    level?: TUtilLogLevel;
    enabled?: boolean;
    format?: string;
    destination?: string;
  };

  // Provider-specific configurations
  providerConfig?: IAgentProviderConfig;

  // Execution options
  stream?: boolean;
  toolChoice?: 'auto' | 'none' | string;
  responseFormat?: IResponseFormatConfig;
  safetySettings?: ISafetySetting[];

  // Performance and limits
  timeout?: number;
  maxExecutionRounds?: number;
  maxSameToolInputs?: number;
  retryAttempts?: number;
  rateLimiting?: {
    enabled?: boolean;
    maxRequests?: number;
    windowMs?: number;
  };

  // Event tracking
  eventService?: IEventService;

  // 🎯 [CONTEXT-INJECTION] Execution context for hierarchical agent management
  executionContext?: IExecutionContextInjection;

  // Execution caching
  cache?: ICacheOptions;

  /**
   * Injected "ask the user" port (CMD-005). When present, tool executions receive it as
   * `IToolExecutionContext.ask` so a model-invoked tool (AskUserQuestion) can solicit a structured
   * answer. Absent in headless/automation contexts.
   */
  ask?: IUserInteraction['ask'];
}

/**
 * Agent template interface
 */
export interface IAgentTemplate {
  id: string;
  name: string;
  description?: string;
  category?: string;
  tags?: string[];
  config: IAgentConfig;
  version?: string;
  author?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Agent run options - type-safe interface for all agent execution options
 */
export interface IRunOptions {
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  toolChoice?: 'auto' | 'none' | string;
  sessionId?: string;
  userId?: string;
  metadata?: TMetadata;
  /** AbortSignal for cancelling execution */
  signal?: AbortSignal;
  /** Per-run streaming text callback. Prefer this over mutating provider callback state. */
  onTextDelta?: TTextDeltaCallback;
  /** Per-run replay event callback for provider/tool execution boundaries. */
  onExecutionEvent?: TExecutionEventCallback;
  /**
   * Maximum model/tool rounds for this run.
   * Use 0 for no core round cap.
   */
  maxExecutionRounds?: number;
  /** Max times the same tool may be called with identical input before aborting. Unset = no limit. */
  maxSameToolInputs?: number;
  /**
   * Treat a turn that ends in tool calls (no trailing text) as a valid completion instead of
   * forcing one extra provider call to generate a summary (CORE-011). For decision-agent patterns
   * (router/orchestrator/classifier) the tool call IS the answer — this removes the one-call tax.
   * The run result's content may be empty; consumers read the outcome from the tool results.
   */
  allowToolOnlyCompletion?: boolean;
  /**
   * Schema-enforced structured output (CORE-015). Accepts a Zod schema or an explicit
   * `{ jsonSchema }` wrapper. `run` then resolves to the validated, typed object instead of a
   * string: the schema is forwarded to the provider's native structured-output surface where one
   * exists, and the final response is always parsed and validated core-side; a violation triggers
   * a bounded retry with the validation issues fed back as the next turn's input. Every attempt is
   * a real conversation turn (history stays append-only). Exhausted retries throw
   * `StructuredOutputError`.
   */
  output?: TStructuredOutputSchema;
  /**
   * Retry budget for structured output validation failures — the number of additional attempts
   * after the first (default 2). Only meaningful with `output` set.
   */
  outputRetries?: number;
}

/**
 * Run options whose `output` is pinned to a concrete schema type (CORE-015).
 * Built with `Omit` rather than an intersection on `output` because Zod v3 object
 * schemas are not assignable to intersections containing themselves (deepPartial
 * variance), which would silently knock out the typed overloads.
 */
export type TRunOptionsWithOutput<TOutput> = Omit<IRunOptions, 'output'> & { output: TOutput };

export type TExecutionEventData = Record<string, unknown>;

export type TExecutionEventCallback = (event: string, data: TExecutionEventData) => void;

/**
 * Generic agent interface with type parameters for enhanced type safety
 *
 * @template TConfig - Agent configuration type (defaults to IAgentConfig for backward compatibility)
 * @template TContext - Execution context type (defaults to IRunOptions for backward compatibility)
 * @template TUniversalMessage - Message type (defaults to TUniversalMessage for backward compatibility)
 */
export interface IAgent<
  TConfig = IAgentConfig,
  TContext = IRunOptions,
  TMessage = TUniversalMessage,
> {
  /**
   * Configure the agent with type-safe configuration
   */
  configure?(config: TConfig): Promise<void>;

  /**
   * Run agent with user input and type-safe context
   */
  run(input: string, context?: TContext): Promise<string>;

  /**
   * Run agent with streaming response and type-safe context
   */
  runStream(input: string, context?: TContext): AsyncGenerator<string, void, never>;

  /**
   * Get conversation history with type-safe messages
   */
  getHistory(): TMessage[];

  /**
   * Clear conversation history
   */
  clearHistory(): void;
}

/**
 * Extended run context with provider-agnostic options
 * Supports dynamic provider configurations without hardcoding specific providers
 */
export interface IExtendedRunContext {
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  toolChoice?: 'auto' | 'none' | string;
  maxExecutionRounds?: number;
  sessionId?: string;
  userId?: string;
  metadata?: TMetadata;

  // Provider-agnostic options that can be used by any provider
  providerOptions?: Record<string, TConfigValue>;

  // Common provider options (provider-agnostic naming)
  stopSequences?: string[];
  topK?: number;
  topP?: number;
  seed?: number;

  // Advanced configuration with specific types
  responseFormat?: IResponseFormatConfig;
  safetySettings?: ISafetySetting[];
  generationConfig?: IGenerationConfig;
}

/**
 * Response format configuration
 */
export interface IResponseFormatConfig {
  type?: 'text' | 'json_object' | 'json_schema';
  /** JSON schema payload; required when `type` is `'json_schema'` (CORE-015). */
  schema?: Record<string, TConfigValue>;
  /** Schema name forwarded to provider native structured-output surfaces. */
  name?: string;
}

/**
 * Safety setting configuration
 */
export interface ISafetySetting {
  category: string;
  threshold: string;
  [key: string]: TConfigValue;
}

/**
 * Generation configuration
 */
export interface IGenerationConfig {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  [key: string]: TConfigValue;
}

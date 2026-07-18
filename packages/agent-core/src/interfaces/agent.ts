import type { ICacheOptions } from './cache';
import type { IUserInteraction } from './interaction';
import type { TUniversalMessageMetadata, TUniversalMessage } from './messages';
import type {
  TProviderConfigValue,
  IAIProvider,
  TTextDeltaCallback,
  TModelEffort,
  TToolChoice,
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
    /** Default tool-invocation directive for every run (CORE-017). `IRunOptions.toolChoice` wins. */
    toolChoice?: TToolChoice;
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
  /**
   * Run-isolated (stateless) mode (CORE-014). Default `true`: history accumulates for the
   * instance's lifetime and the FULL history is sent to the provider on EVERY call — token cost
   * grows every turn. Set `false` to make the conversation store ephemeral per run: a run executes
   * on whatever is currently in the store (system prompt + any injected context + the prompt), and
   * the store resets after the run settles, so nothing accumulates across runs (the system prompt
   * re-applies on the next run). Equivalent to calling `clearHistory()` around every run, but
   * declared once and immune to a missed clear. `getHistory()` after a run returns empty in this
   * mode — read the response from the run's return value or execution events.
   */
  retainHistory?: boolean;

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
  responseFormat?: IResponseFormatConfig;
  safetySettings?: ISafetySetting[];

  // Performance and limits
  timeout?: number;
  /**
   * Default maximum execution rounds per run (round = one model call + its requested tool
   * executions; see `IRunOptions.maxExecutionRounds` for the full semantics). 0 = no cap.
   */
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
  /** Run-scoped temperature override — wins over `defaultModel.temperature` (CORE-016). */
  temperature?: number;
  /** Run-scoped max output tokens override — wins over `defaultModel.maxTokens` (CORE-016). */
  maxTokens?: number;
  /**
   * Run-scoped tool-invocation directive — wins over `defaultModel.toolChoice` (CORE-017).
   * `'auto'` (model decides), `'none'` (suppress tool calls), `'required'` (must call some
   * tool), or `{ tool: name }` (must call the named tool; the name is validated against the
   * run's tool list and a miss throws). Forcing applies to the run's first model call only;
   * rounds after tool results revert to `'auto'` (see `TToolChoice`).
   */
  toolChoice?: TToolChoice;
  sessionId?: string;
  userId?: string;
  metadata?: TMetadata;
  /**
   * Run-scoped EPHEMERAL system context (SELFHOST-008 P3). A transient system-role block included in THIS
   * run's provider request(s) only — it is **never written to the conversation store** and never persisted,
   * so it does not bloat history or force a static-system-prompt rebuild. Content-free neutral channel: the
   * caller decides what to put here (e.g. per-turn recalled memory). Absent ⇒ no change.
   */
  ephemeralSystemContext?: string;
  /** AbortSignal for cancelling execution */
  signal?: AbortSignal;
  /** Per-run streaming text callback. Prefer this over mutating provider callback state. */
  onTextDelta?: TTextDeltaCallback;
  /** Per-run replay event callback for provider/tool execution boundaries. */
  onExecutionEvent?: TExecutionEventCallback;
  /**
   * Maximum execution rounds for this run. A **round** is one provider (model) call plus the
   * execution of every tool call that reply requested; a reply with no tool calls ends the loop,
   * so a plain Q&A turn is exactly 1 round. This caps model/tool cycles within ONE `run()` — it is
   * not a tool-count limit and not a multi-turn conversation limit. When the cap is hit the run
   * stops after the current round. Use 0 for no core round cap. Defaults to
   * `IAgentConfig.maxExecutionRounds`.
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

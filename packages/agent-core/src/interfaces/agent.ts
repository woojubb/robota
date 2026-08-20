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
import type { IResponseFormatConfig, ISafetySetting } from './response-format';
import type { IRunOptions } from './run-options';
import type { TMetadata, TConfigValue } from './types';
import type { IModule } from '../abstracts/abstract-module';
import type { IPluginContract, IPluginOptions, IPluginStats } from '../abstracts/abstract-plugin';
import type { IToolWithEventService } from '../abstracts/abstract-tool';
import type { IEventService, IOwnerPathSegment } from '../interfaces/event-service';
import type { TStructuredOutputSchema } from '../schema/structured-output';

export type { IRunOptions, TExecutionEventCallback, TExecutionEventData } from './run-options';
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
  /**
   * Remediation hint appended to the core-emitted context hard-capacity notice. The core
   * default is product-neutral; a surface tier may inject product-specific wording here
   * (e.g. its own compaction command). See execution-round-context.
   */
  contextCapacityHint?: string;

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
 * Run options whose `output` is pinned to a concrete schema type (CORE-015).
 * Built with `Omit` rather than an intersection on `output` because Zod v3 object
 * schemas are not assignable to intersections containing themselves (deepPartial
 * variance), which would silently knock out the typed overloads.
 */
export type TRunOptionsWithOutput<TOutput> = Omit<IRunOptions, 'output'> & { output: TOutput };

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

  /** Streams the turn's text deltas and returns its final assistant text (CORE-042). */
  runStream(input: string, context?: TContext): AsyncGenerator<string, string, never>;

  /**
   * Get conversation history with type-safe messages
   */
  getHistory(): TMessage[];

  /**
   * Clear conversation history
   */
  clearHistory(): void;
}

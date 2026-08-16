import type { TUniversalMessage, IToolCall } from './messages';
import type { IProviderCapabilities, IProviderNativeWebToolRequest } from './provider-capabilities';
import type { IProviderModelCatalog } from './provider-definition';
import type { IProviderSpecificOptions } from './provider-specific-options';
import type { IToolSchema } from './tool-schema';

export type {
  IProviderCapabilities,
  IProviderFunctionCallingCapability,
  IProviderNativeWebToolCapabilities,
  IProviderNativeWebToolCapability,
  IProviderNativeWebToolRequest,
} from './provider-capabilities';
export {
  assertProviderNativeWebToolsAvailable,
  createDefaultProviderCapabilities,
  getProviderCapabilities,
} from './provider-capabilities';

/**
 * Reusable type definitions for provider layer
 */

/**
 * Provider configuration value type
 * Used for storing provider-specific configuration values
 */
export type TProviderConfigValue = string | number | boolean;

export type { IProviderSpecificOptions } from './provider-specific-options';

// The universal JSON-schema subset moved to `./tool-schema` (CORE-039): it is its own concept,
// reached by producers, validators and four provider adapters, and `provider.ts` was over its
// frozen size baseline. Re-exported here so every existing `from './provider'` import resolves.
export type {
  IObjectParameterSchema,
  IParameterSchema,
  IToolSchema,
  TJSONSchemaEnum,
  TJSONSchemaKind,
  TParameterDefaultValue,
} from './tool-schema';

/**
 * Token usage statistics
 */
export interface ITokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Raw provider response interface
 */
export interface IRawProviderResponse {
  content: string | null;
  toolCalls?: IToolCall[];
  usage?: ITokenUsage;
  finishReason?: string;
  model?: string;
  metadata?: Record<string, TProviderConfigValue>;
}

/**
 * Provider request payload
 */
export interface IProviderRequest {
  messages: TUniversalMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: IToolSchema[];
  systemMessage?: string;
  metadata?: Record<string, string | number | boolean>;
}

export type TTextDeltaCallback = (delta: string) => void;

export type TProviderNativeRawPayloadKind = 'request' | 'response' | 'stream_event';

export type TProviderNativeRawPayload = string | number | boolean | object | null | undefined;

export interface IProviderNativeRawPayloadEvent {
  provider: string;
  apiSurface?: string;
  payloadKind: TProviderNativeRawPayloadKind;
  payload: TProviderNativeRawPayload;
  sequence?: number;
  metadata?: Record<string, TProviderConfigValue>;
}

export type TProviderNativeRawPayloadCallback = (event: IProviderNativeRawPayloadEvent) => void;

/**
 * Reasoning-effort dial threaded per model invocation.
 *
 * Canonical SSOT for the effort union. `'high'` is the neutral default applied when
 * a caller leaves effort unset; `'xhigh'` is the long-running ("ultra") tier and
 * `'max'` the most exhaustive tier. Providers with a native reasoning-effort parameter
 * map this value onto it (clamping to their supported range); providers without a
 * native effort concept ignore it as a documented no-op.
 */
export type TModelEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Tool-invocation directive threaded per model invocation (CORE-017).
 *
 * Canonical SSOT for the union. `'auto'` lets the model decide (provider default),
 * `'none'` suppresses tool calls for the invocation, `'required'` forces the model to call
 * some tool, and `{ tool: name }` forces a call to the named tool. Core validates that a
 * named tool exists in the invocation's tool list and that `'required'`/named forcing is
 * only used when tools are present — a violation throws instead of degrading silently.
 * Within a multi-round run, forcing directives apply to the FIRST model call only; rounds
 * after tool results revert to `'auto'` so the model can consume the results and finish.
 */
export type TToolChoice = 'auto' | 'none' | 'required' | { tool: string };

/**
 * Options for AI provider chat requests
 */
export interface IChatOptions extends IProviderSpecificOptions {
  /** Tool schemas to provide to the AI provider */
  tools?: IToolSchema[];
  /** Maximum number of tokens to generate */
  maxTokens?: number;
  /** Temperature for response randomness (0-1) */
  temperature?: number;
  /**
   * Reasoning-effort dial for this invocation. Native-effort providers map it to their
   * request parameter; providers without native effort ignore it (documented no-op).
   * Threaded from session/model options; defaults to `'high'` at the framework→provider seam.
   */
  effort?: TModelEffort;
  /** Model to use for the request */
  model?: string;
  /** Callback for text deltas during streaming. When provided, the provider
   *  should use streaming internally and call this for each text chunk,
   *  while still returning the complete assembled message. */
  onTextDelta?: TTextDeltaCallback;
  /** Callback for provider-owned native SDK request/response/stream payload capture. */
  onProviderNativeRawPayload?: TProviderNativeRawPayloadCallback;
  /** AbortSignal for cancelling the provider call */
  signal?: AbortSignal;
  /**
   * Tool-invocation directive for this call. Adapters map it onto their wire format
   * (`tool_choice` / `functionCallingConfig`); omitted = provider default ('auto').
   */
  toolChoice?: TToolChoice;
  /** Provider-native hosted web tools requested for this call */
  nativeWebTools?: IProviderNativeWebToolRequest;
  /** Request structured output from the provider (CORE-015: `json_schema` carries the schema). */
  responseFormat?:
    | { type: 'text' | 'json_object' }
    | { type: 'json_schema'; name?: string; schema: Record<string, unknown> };
}

/**
 * Provider-agnostic AI Provider interface
 * This interface uses only TUniversalMessage types and avoids provider-specific types
 */
export interface IAIProvider {
  /** Provider identifier */
  readonly name: string;
  /** Provider version */
  readonly version: string;

  /**
   * Generate response from AI model using TUniversalMessage
   * @param messages - Array of TUniversalMessage from conversation history
   * @param options - Chat options including tools, model settings, etc.
   * @returns Promise resolving to a TUniversalMessage response
   */
  chat(messages: TUniversalMessage[], options?: IChatOptions): Promise<TUniversalMessage>;

  /**
   * Generate streaming response from AI model using TUniversalMessage
   * @param messages - Array of TUniversalMessage from conversation history
   * @param options - Chat options including tools, model settings, etc.
   * @returns AsyncIterable of TUniversalMessage chunks
   */
  chatStream?(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): AsyncIterable<TUniversalMessage>;

  /**
   * Generate response from AI model (raw provider response)
   * @param payload - Provider request payload
   * @returns Promise resolving to raw provider response
   */
  generateResponse(payload: IProviderRequest): Promise<IRawProviderResponse>;

  /**
   * Generate streaming response from AI model (raw provider response)
   * @param payload - Provider request payload
   * @returns AsyncIterable of raw provider response chunks
   */
  generateStreamingResponse?(payload: IProviderRequest): AsyncIterable<IRawProviderResponse>;

  /**
   * Check if the provider supports tool calling
   * @returns true if tool calling is supported
   */
  supportsTools(): boolean;

  /**
   * Report provider-neutral capability state.
   * Providers without native web support can omit this and use default capability helpers.
   */
  getCapabilities?(): IProviderCapabilities;

  /**
   * This provider's model catalog, so a PER-MODEL capability is resolvable at call time (PROV-006).
   *
   * `supportsTools()` answers for the vendor, which is the wrong granularity when models differ —
   * deepseek returned an unconditional `true` while its own catalog said `deepseek-reasoner` has
   * none. Optional, and silence is NOT denial: see `interfaces/model-capability.ts`.
   */
  modelCatalog?(): IProviderModelCatalog | undefined;

  /**
   * Optional generic hook for enabling provider-native hosted web behavior.
   */
  configureNativeWebTools?(request: IProviderNativeWebToolRequest): IProviderCapabilities;

  /**
   * Validate provider configuration
   * @returns true if configuration is valid
   */
  validateConfig(): boolean;

  /**
   * Clean up resources when provider is no longer needed
   */
  dispose?(): Promise<void>;

  /**
   * Close provider connections and cleanup resources
   */
  close?(): Promise<void>;
}

/**
 * Provider options interface
 */
export interface IProviderOptions {
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
  retries?: number;
  maxConcurrentRequests?: number;
  defaultModel?: string;
  organization?: string;
  project?: string;
  /** Additional provider-specific configuration */
  extra?: Record<string, TProviderConfigValue>;
}

/**
 * Base union for provider option values.
 *
 * Purpose:
 * - Enable provider packages to compose their own option value unions without redefining the primitives.
 * - Keep the shared axis in @robota-sdk/agent-core (SSOT).
 *
 * Note:
 * - Provider packages may extend this with provider-specific runtime objects (e.g., OpenAI/Anthropic clients).
 */
export type TProviderOptionValueBase =
  | string
  | number
  | boolean
  | undefined
  | null
  | TProviderOptionValueBase[]
  | { [key: string]: TProviderOptionValueBase };

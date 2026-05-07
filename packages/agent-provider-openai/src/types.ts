import OpenAI from 'openai';

import type { IPayloadLogger } from './interfaces/payload-logger';
import type { IExecutor, ILogger, TProviderOptionValueBase } from '@robota-sdk/agent-core';

export type TOpenAIApiSurface = 'responses' | 'chat-completions';

export interface IOpenAIJsonSchemaDefinition {
  name: string;
  description?: string;
  schema?: Record<string, TOpenAIProviderOptionValue>;
  strict?: boolean;
}

export interface IOpenAIResponsesReasoningOptions {
  effort?: 'low' | 'medium' | 'high';
  summary?: 'auto' | 'concise' | 'detailed';
}

export interface IOpenAINativeWebToolsOptions {
  webSearch?: boolean;
  webFetch?: boolean;
}

/**
 * Valid provider option value types
 */
export type TOpenAIProviderOptionValue =
  | string
  | number
  | boolean
  | undefined
  | null
  | IOpenAIJsonSchemaDefinition
  | IOpenAINativeWebToolsOptions
  | IOpenAIResponsesReasoningOptions
  | OpenAI
  | IPayloadLogger
  | ILogger
  | IExecutor
  | TProviderOptionValueBase
  | TOpenAIProviderOptionValue[]
  | { [key: string]: TOpenAIProviderOptionValue };

/**
 * OpenAI provider options
 */
export interface IOpenAIProviderOptions {
  /**
   * Additional provider-specific options
   */
  [key: string]: TOpenAIProviderOptionValue;

  /**
   * OpenAI API key (required when client is not provided)
   */
  apiKey?: string;

  /**
   * OpenAI organization ID (optional)
   */
  organization?: string;

  /**
   * API request timeout (milliseconds)
   */
  timeout?: number;

  /**
   * API base URL (default: 'https://api.openai.com/v1')
   */
  baseURL?: string;

  /**
   * Default model used when chat options do not provide a model.
   */
  defaultModel?: string;

  /**
   * API surface to use for direct OpenAI calls.
   *
   * Defaults to Responses for official OpenAI calls. Profiles with baseURL use
   * Chat Completions by default for OpenAI-compatible endpoint compatibility.
   */
  apiSurface?: TOpenAIApiSurface;

  /**
   * Response format (default: 'text')
   * - 'text': Plain text response
   * - 'json_object': JSON object mode (requires system message)
   * - 'json_schema': Structured Outputs with schema validation
   */
  responseFormat?: 'text' | 'json_object' | 'json_schema';

  /**
   * JSON schema for structured outputs (required when responseFormat is 'json_schema')
   */
  jsonSchema?: IOpenAIJsonSchemaDefinition;

  /**
   * Responses API reasoning controls. Hidden reasoning is never exposed in message
   * content; only explicit summaries/encrypted items requested here are represented.
   */
  reasoning?: IOpenAIResponsesReasoningOptions;

  /**
   * Whether OpenAI should store Responses API results. Defaults to OpenAI API behavior.
   */
  store?: boolean;

  /**
   * Include encrypted reasoning items for stateless reasoning continuation.
   */
  includeEncryptedReasoning?: boolean;

  /**
   * Opt into strict custom function parameter validation where supported.
   */
  strictTools?: boolean;

  /**
   * Provider-native hosted web tool request from provider profile options.
   *
   * OpenAI-compatible Chat Completions endpoints do not support this Robota
   * native web contract. The provider rejects unsupported configurations before
   * any model request is sent.
   */
  nativeWebTools?: IOpenAINativeWebToolsOptions;

  /**
   * OpenAI client instance (optional: will be created from apiKey if not provided)
   */
  client?: OpenAI;

  /**
   * Payload logger instance for debugging API requests/responses
   *
   * Use different implementations based on your environment:
   * - FilePayloadLogger: Node.js file-based logging
   * - ConsolePayloadLogger: Browser console-based logging
   * - Custom: Implement IPayloadLogger interface
   *
   * @example
   * ```typescript
   * // Node.js
   * import { FilePayloadLogger } from '@robota-sdk/agent-provider-openai/loggers/file';
   * const provider = new OpenAIProvider({
   *   client: openaiClient,
   *   payloadLogger: new FilePayloadLogger({ logDir: './logs/openai' })
   * });
   *
   * // Browser
   * import { ConsolePayloadLogger } from '@robota-sdk/agent-provider-openai/loggers/console';
   * const provider = new OpenAIProvider({
   *   client: openaiClient,
   *   payloadLogger: new ConsolePayloadLogger()
   * });
   * ```
   */
  payloadLogger?: IPayloadLogger;

  /**
   * Optional executor for handling AI requests
   *
   * When provided, the provider will delegate all chat operations to this executor
   * instead of making direct API calls. This enables remote execution capabilities.
   *
   * @example
   * ```typescript
   * import { LocalExecutor, RemoteExecutor } from '@robota-sdk/agent-core';
   *
   * // Local execution (registers this provider)
   * const localExecutor = new LocalExecutor();
   * localExecutor.registerProvider('openai', new OpenAIProvider({ apiKey: 'sk-...' }));
   *
   * // Remote execution
   * const remoteExecutor = new RemoteExecutor({
   *   serverUrl: 'https://api.robota.io',
   *   userApiKey: 'user-token-123'
   * });
   *
   * const provider = new OpenAIProvider({
   *   executor: remoteExecutor // No direct API key needed
   * });
   * ```
   */
  executor?: IExecutor;

  /**
   * Logger instance for internal OpenAI provider logging
   * @defaultValue SilentLogger
   */
  logger?: ILogger;
}

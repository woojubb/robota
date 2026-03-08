import OpenAI from 'openai';

import type { IPayloadLogger } from './interfaces/payload-logger';
import type { IExecutor, ILogger, TProviderOptionValueBase } from '@robota-sdk/agents';

/**
 * Valid provider option value types
 */
export type TOpenAIProviderOptionValue =
  | string
  | number
  | boolean
  | undefined
  | null
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
   * Response format (default: 'text')
   * - 'text': Plain text response
   * - 'json_object': JSON object mode (requires system message)
   * - 'json_schema': Structured Outputs with schema validation
   */
  responseFormat?: 'text' | 'json_object' | 'json_schema';

  /**
   * JSON schema for structured outputs (required when responseFormat is 'json_schema')
   */
  jsonSchema?: {
    name: string;
    description?: string;
    schema?: Record<string, TOpenAIProviderOptionValue>;
    strict?: boolean;
  };

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
   * import { FilePayloadLogger } from '@robota-sdk/openai/loggers/file';
   * const provider = new OpenAIProvider({
   *   client: openaiClient,
   *   payloadLogger: new FilePayloadLogger({ logDir: './logs/openai' })
   * });
   * 
   * // Browser
   * import { ConsolePayloadLogger } from '@robota-sdk/openai/loggers/console';
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
   * import { LocalExecutor, RemoteExecutor } from '@robota-sdk/agents';
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
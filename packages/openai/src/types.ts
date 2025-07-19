import OpenAI from 'openai';

import type { PayloadLogger } from './interfaces/payload-logger';
import type { SimpleLogger } from '@robota-sdk/agents';

/**
 * Valid provider option value types
 */
export type ProviderOptionValue = string | number | boolean | undefined | null | OpenAI | PayloadLogger | SimpleLogger | ProviderOptionValue[] | { [key: string]: ProviderOptionValue };

/**
 * Base provider options interface
 */
export interface ProviderOptions {
  /**
   * Additional provider-specific options
   */
  [key: string]: ProviderOptionValue;
}

/**
 * OpenAI provider options
 */
export interface OpenAIProviderOptions extends ProviderOptions {
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
   * - 'json_object': Legacy JSON mode (requires system message)
   * - 'json_schema': Structured Outputs with schema validation
   */
  responseFormat?: 'text' | 'json_object' | 'json_schema';

  /**
   * JSON schema for structured outputs (required when responseFormat is 'json_schema')
   */
  jsonSchema?: {
    name: string;
    description?: string;
    schema?: Record<string, ProviderOptionValue>;
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
   * - Custom: Implement PayloadLogger interface
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
  payloadLogger?: PayloadLogger;

  /**
   * Logger instance for internal OpenAI provider logging
   * @defaultValue SilentLogger
   */
  logger?: SimpleLogger;
} 
import OpenAI from 'openai';

/**
 * Base provider options interface
 */
export interface ProviderOptions {
  /**
   * Model name to use
   */
  model?: string;

  /**
   * Additional provider-specific options
   */
  [key: string]: unknown;
}

/**
 * OpenAI provider options
 */
export interface OpenAIProviderOptions extends Omit<ProviderOptions, 'model'> {
  /**
   * Default model name to use (default: gpt-4)
   */
  model?: string;

  /**
   * Temperature (0~1)
   */
  temperature?: number;

  /**
   * Maximum number of tokens
   */
  maxTokens?: number;

  /**
   * OpenAI API key (optional: not required when using client)
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
    schema?: Record<string, string | number | boolean | object>;
    strict?: boolean;
  };

  /**
   * OpenAI client instance (required)
   */
  client: OpenAI;

  /**
   * Enable API payload logging to files
   * When enabled, saves API request payloads to log files
   * 
   * @defaultValue false
   */
  enablePayloadLogging?: boolean;

  /**
   * Directory path for storing API payload log files
   * 
   * @defaultValue './logs/api-payloads'
   */
  payloadLogDir?: string;

  /**
   * Include timestamp in payload log filenames
   * 
   * @defaultValue true
   */
  includeTimestampInLogFiles?: boolean;
} 
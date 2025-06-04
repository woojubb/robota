import { ProviderOptions } from '@robota-sdk/core';
import OpenAI from 'openai';

/**
 * OpenAI provider options
 */
export interface OpenAIProviderOptions extends ProviderOptions {
  /**
   * Model name to use (default: gpt-3.5-turbo)
   */
  model: string;

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
    schema?: Record<string, unknown>;
    strict?: boolean;
  };

  /**
   * OpenAI client instance (required)
   */
  client: OpenAI;
} 
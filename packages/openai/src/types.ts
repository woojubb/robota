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
   * Response format (default: 'json')
   */
  responseFormat?: 'json' | 'text';

  /**
   * OpenAI client instance (required)
   */
  client: OpenAI;
} 
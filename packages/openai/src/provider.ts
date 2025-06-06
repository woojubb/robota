import OpenAI from 'openai';
import {
  Context,
  ModelResponse,
  StreamingResponseChunk,
  AIProvider
} from '@robota-sdk/core';
import type { FunctionDefinition } from '@robota-sdk/tools';
import { OpenAIProviderOptions } from './types';
import { logger } from '@robota-sdk/core';
import { OpenAIConversationAdapter } from './adapter';

/**
 * OpenAI provider implementation for Robota
 * 
 * Provides integration with OpenAI's GPT models and other services.
 * Implements the universal AIProvider interface for consistent usage across providers.
 * 
 * @see {@link ../../../apps/examples/03-integrations | Provider Integration Examples}
 * 
 * @public
 */
export class OpenAIProvider implements AIProvider {
  /**
   * Provider identifier name
   * @readonly
   */
  public readonly name: string = 'openai';

  /**
   * OpenAI client instance
   * @internal
   */
  private readonly client: OpenAI;

  /**
   * Client type identifier
   * @readonly
   */
  public readonly type: string = 'openai';

  /**
   * OpenAI client instance (alias for backwards compatibility)
   * @readonly
   * @deprecated Use the private client property instead
   */
  public readonly instance: OpenAI;

  /**
   * Provider configuration options
   * @readonly
   */
  public readonly options: OpenAIProviderOptions;

  /**
   * Create a new OpenAI provider instance
   * 
   * @param options - Configuration options for the OpenAI provider
   * 
   * @throws {Error} When client is not provided in options
   */
  constructor(options: OpenAIProviderOptions) {
    this.options = {
      temperature: 0.7,
      maxTokens: undefined,
      ...options
    };

    // Validate required client injection
    if (!options.client) {
      throw new Error('OpenAI client is not injected. The client option is required.');
    }

    this.client = options.client;
    this.instance = options.client; // Maintain backwards compatibility
  }

  /**
   * Convert function definitions to OpenAI tool format
   * 
   * Transforms universal function definitions into OpenAI's specific tool format
   * required by the Chat Completions API.
   * 
   * @param functions - Array of universal function definitions
   * @returns Array of OpenAI-formatted tools
   */
  formatFunctions(functions: FunctionDefinition[]): OpenAI.Chat.ChatCompletionTool[] {
    return functions.map(fn => ({
      type: 'function',
      function: {
        name: fn.name,
        description: fn.description || '',
        parameters: fn.parameters || { type: 'object', properties: {} }
      }
    }));
  }

  /**
   * Send a chat request to OpenAI and receive a complete response
   * 
   * Processes the provided context and sends it to OpenAI's Chat Completions API.
   * Handles message format conversion, error handling, and response parsing.
   * 
   * @param model - Model name to use (e.g., 'gpt-4', 'gpt-3.5-turbo')
   * @param context - Context object containing messages and system prompt
   * @param options - Optional generation parameters and tools
   * @returns Promise resolving to the model's response
   * 
   * @throws {Error} When context is invalid
   * @throws {Error} When messages array is invalid
   * @throws {Error} When message format conversion fails
   * @throws {Error} When OpenAI API call fails
   */
  async chat(model: string, context: Context, options?: any): Promise<ModelResponse> {
    // Validate context parameter
    if (!context || typeof context !== 'object') {
      logger.error('[OpenAIProvider] Invalid context:', context);
      throw new Error('Valid Context object is required');
    }

    const { messages } = context;

    // Validate messages array
    if (!Array.isArray(messages)) {
      logger.error('[OpenAIProvider] Invalid message array:', messages);
      throw new Error('Valid message array is required');
    }

    // Convert messages to OpenAI format and filter out tool messages
    const openaiMessages = OpenAIConversationAdapter.toOpenAIFormat(context.messages);

    // Debug: Log the messages being sent
    logger.info('Debug - Messages being sent to OpenAI:');
    logger.info(JSON.stringify(openaiMessages, null, 2));
    logger.info('Original messages count:', context.messages.length);
    logger.info('Filtered messages count:', openaiMessages.length);

    const completionOptions: OpenAI.Chat.ChatCompletionCreateParams = {
      model,
      messages: openaiMessages,
      max_tokens: options?.maxTokens || this.options.maxTokens,
      temperature: options?.temperature || this.options.temperature,
    };

    // Add tool provider functions
    if (options?.tools && Array.isArray(options.tools)) {
      completionOptions.tools = this.formatFunctions(options.tools);
    }

    // Set response format if specified
    if (this.options.responseFormat) {
      if (this.options.responseFormat === 'text') {
        completionOptions.response_format = { type: 'text' };
      } else if (this.options.responseFormat === 'json_object') {
        completionOptions.response_format = { type: 'json_object' };
      } else if (this.options.responseFormat === 'json_schema') {
        if (!this.options.jsonSchema) {
          throw new Error('jsonSchema is required when responseFormat is "json_schema"');
        }
        completionOptions.response_format = {
          type: 'json_schema',
          json_schema: this.options.jsonSchema
        };
      }
    }

    try {
      logger.info('[OpenAIProvider] API request options:', JSON.stringify(completionOptions, null, 2));
      const response = await this.client.chat.completions.create(completionOptions);
      return this.parseResponse(response);
    } catch (error) {
      logger.error('[OpenAIProvider] API call error:', error);
      throw error;
    }
  }

  /**
   * Convert OpenAI API response to universal ModelResponse format
   * 
   * Transforms the OpenAI-specific response format into the standard format
   * used across all providers in Robota.
   * 
   * @param response - Raw response from OpenAI Chat Completions API
   * @returns Parsed model response in universal format
   * 
   * @internal
   */
  parseResponse(response: OpenAI.Chat.ChatCompletion): ModelResponse {
    const message = response.choices[0].message;

    const result: ModelResponse = {
      content: message.content || undefined,
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens
      } : undefined,
      metadata: {
        model: response.model,
        finishReason: response.choices[0].finish_reason,
        systemFingerprint: response.system_fingerprint
      }
    };

    // Handle function calls (legacy format)
    if (message.function_call) {
      result.functionCall = {
        name: message.function_call.name,
        arguments: message.function_call.arguments
      };
    }

    // Handle tool calls (current format)
    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolCall = message.tool_calls[0];
      if (toolCall.type === 'function') {
        result.functionCall = {
          name: toolCall.function.name,
          arguments: toolCall.function.arguments
        };
      }
    }

    return result;
  }

  /**
   * Convert OpenAI streaming response chunk to universal format
   * 
   * Transforms individual chunks from OpenAI's streaming response into the
   * standard StreamingResponseChunk format used across all providers.
   * 
   * @param chunk - Raw chunk from OpenAI streaming API
   * @returns Parsed streaming response chunk
   * 
   * @internal
   */
  parseStreamingChunk(chunk: OpenAI.Chat.ChatCompletionChunk): StreamingResponseChunk {
    const delta = chunk.choices[0].delta;

    const result: StreamingResponseChunk = {
      content: delta.content || undefined,
      isComplete: chunk.choices[0].finish_reason !== null
    };

    // Handle function call chunks (legacy format)
    if (delta.function_call) {
      result.functionCall = {
        name: delta.function_call.name,
        arguments: delta.function_call.arguments
      };
    }

    // Handle tool call chunks (current format)
    if (delta.tool_calls && delta.tool_calls.length > 0) {
      const toolCall = delta.tool_calls[0];
      if (toolCall.type === 'function') {
        result.functionCall = {
          name: toolCall.function?.name,
          arguments: toolCall.function?.arguments
        };
      }
    }

    return result;
  }

  /**
   * Send a streaming chat request to OpenAI and receive response chunks
   * 
   * Similar to chat() but returns an async iterator that yields response chunks
   * as they arrive from OpenAI's streaming API. Useful for real-time display
   * of responses or handling large responses incrementally.
   * 
   * @param model - Model name to use
   * @param context - Context object containing messages and system prompt
   * @param options - Optional generation parameters and tools
   * @returns Async generator yielding response chunks
   * 
   * @throws {Error} When context is invalid
   * @throws {Error} When messages array is invalid
   * @throws {Error} When message format conversion fails
   * @throws {Error} When OpenAI streaming API call fails
   * 
   * @see {@link ../../../apps/examples/01-basic | Basic Usage Examples}
   */
  async *chatStream(model: string, context: Context, options?: any): AsyncGenerator<StreamingResponseChunk, void, unknown> {
    // Validate context parameter
    if (!context || typeof context !== 'object') {
      logger.error('[OpenAIProvider] Invalid context:', context);
      throw new Error('Valid Context object is required');
    }

    const { messages } = context;

    // Validate messages array
    if (!Array.isArray(messages)) {
      logger.error('[OpenAIProvider] Invalid message array:', messages);
      throw new Error('Valid message array is required');
    }

    // Convert messages to OpenAI format and filter out tool messages
    const openaiMessages = OpenAIConversationAdapter.toOpenAIFormat(context.messages);

    // Debug: Log the messages being sent
    logger.info('Debug - Messages being sent to OpenAI:');
    logger.info(JSON.stringify(openaiMessages, null, 2));
    logger.info('Original messages count:', context.messages.length);
    logger.info('Filtered messages count:', openaiMessages.length);

    const completionOptions: OpenAI.Chat.ChatCompletionCreateParams = {
      model,
      messages: openaiMessages,
      max_tokens: options?.maxTokens || this.options.maxTokens,
      temperature: options?.temperature || this.options.temperature,
      stream: true
    };

    // Add tool provider functions
    if (options?.tools && Array.isArray(options.tools)) {
      completionOptions.tools = this.formatFunctions(options.tools);
    }

    // Set response format if specified
    if (this.options.responseFormat) {
      if (this.options.responseFormat === 'text') {
        completionOptions.response_format = { type: 'text' };
      } else if (this.options.responseFormat === 'json_object') {
        completionOptions.response_format = { type: 'json_object' };
      } else if (this.options.responseFormat === 'json_schema') {
        if (!this.options.jsonSchema) {
          throw new Error('jsonSchema is required when responseFormat is "json_schema"');
        }
        completionOptions.response_format = {
          type: 'json_schema',
          json_schema: this.options.jsonSchema
        };
      }
    }

    try {
      logger.info('[OpenAIProvider] Streaming API request options:', JSON.stringify({
        ...completionOptions,
        stream: true
      }, null, 2));

      const stream = await this.client.chat.completions.create(completionOptions);

      for await (const chunk of stream) {
        yield this.parseStreamingChunk(chunk);
      }
    } catch (error) {
      logger.error('[OpenAIProvider] Streaming API call error:', error);
      throw error;
    }
  }

  /**
   * Release resources and close connections
   * 
   * Performs cleanup operations when the provider is no longer needed.
   * OpenAI client doesn't require explicit cleanup, so this is a no-op.
   * 
   * @returns Promise that resolves when cleanup is complete
   */
  async close(): Promise<void> {
    // OpenAI client doesn't have explicit close method
    // This is implemented as no-op for interface compliance
  }
} 
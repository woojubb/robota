import OpenAI from 'openai';
import {
  Context,
  Message,
  ModelResponse,
  StreamingResponseChunk,
  AIProvider,
  UniversalMessage
} from '@robota-sdk/core';
import type { FunctionDefinition } from '@robota-sdk/tools';
import { OpenAIProviderOptions } from './types';
import { logger } from '@robota-sdk/core';
import { OpenAIConversationAdapter } from './adapter';

/**
 * OpenAI provider implementation
 * 
 * Implements the AIProvider interface to integrate with Robota.
 */
export class OpenAIProvider implements AIProvider {
  /**
   * Provider name
   */
  public name: string = 'openai';

  /**
   * OpenAI client instance
   */
  private client: OpenAI;

  /**
   * Client type
   */
  public type: string = 'openai';

  /**
   * Client instance
   */
  public instance: OpenAI;

  /**
   * Provider options
   */
  public options: OpenAIProviderOptions;

  constructor(options: OpenAIProviderOptions) {
    this.options = {
      temperature: 0.7,
      maxTokens: undefined,
      ...options
    };

    // Throw error if client is not injected
    if (!options.client) {
      throw new Error('OpenAI client is not injected. The client option is required.');
    }

    this.client = options.client;
    this.instance = options.client;
  }

  /**
   * Convert messages to OpenAI format
   * @deprecated Use OpenAIConversationAdapter.toOpenAIFormat instead
   */
  formatMessages(messages: Message[]): OpenAI.Chat.ChatCompletionMessageParam[] {
    if (!Array.isArray(messages)) {
      logger.error('formatMessages: messages must be an array.', messages);
      return [];
    }

    const formattedMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    for (const message of messages) {
      if (!message || typeof message !== 'object') {
        logger.error('formatMessages: invalid message format', message);
        continue;
      }

      const { role, content, name, functionCall } = message;

      // If there is a function call result
      if (role === 'function') {
        formattedMessages.push({
          role: 'function',
          name: name || '',
          content: typeof content === 'string' ? content : JSON.stringify(content)
        });
        continue;
      }

      // If there is a function call
      if (functionCall) {
        formattedMessages.push({
          role: role === 'user' ? 'user' :
            role === 'system' ? 'system' : 'assistant',
          content: content || '',
          function_call: {
            name: functionCall.name,
            arguments: typeof functionCall.arguments === 'string'
              ? functionCall.arguments
              : JSON.stringify(functionCall.arguments)
          }
        });
        continue;
      }

      // Regular message
      formattedMessages.push({
        role: role === 'user' ? 'user' :
          role === 'system' ? 'system' : 'assistant',
        content: content || '',
        name
      });
    }

    return formattedMessages;
  }

  /**
   * Convert function definitions to OpenAI format
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
   * Convert OpenAI API response to standard format
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
        finishReason: response.choices[0].finish_reason
      }
    };

    // If there is a function call
    if (message.function_call) {
      result.functionCall = {
        name: message.function_call.name,
        arguments: message.function_call.arguments
      };
    }

    return result;
  }

  /**
   * Convert streaming response chunk to standard format
   */
  parseStreamingChunk(chunk: OpenAI.Chat.ChatCompletionChunk): StreamingResponseChunk {
    const delta = chunk.choices[0].delta;

    const result: StreamingResponseChunk = {
      content: delta.content || undefined,
      isComplete: chunk.choices[0].finish_reason !== null
    };

    // If there is a function call chunk
    if (delta.function_call) {
      result.functionCall = {
        name: delta.function_call.name,
        arguments: delta.function_call.arguments
      };
    }

    return result;
  }

  /**
   * Model chat request
   */
  async chat(model: string, context: Context, options?: any): Promise<ModelResponse> {
    if (!context || typeof context !== 'object') {
      logger.error('[OpenAIProvider] Invalid context:', context);
      throw new Error('Valid Context object is required');
    }

    const { messages, systemPrompt } = context;

    if (!Array.isArray(messages)) {
      logger.error('[OpenAIProvider] Invalid message array:', messages);
      throw new Error('Valid message array is required');
    }

    // Convert UniversalMessage[] to OpenAI format
    let formattedMessages: OpenAI.Chat.ChatCompletionMessageParam[];

    try {
      formattedMessages = OpenAIConversationAdapter.toOpenAIFormat(messages as UniversalMessage[]);

      // Add system prompt if needed
      formattedMessages = OpenAIConversationAdapter.addSystemPromptIfNeeded(formattedMessages, systemPrompt);
    } catch (error) {
      logger.error('[OpenAIProvider] Message conversion error:', error);
      throw new Error('Failed to convert message format');
    }

    if (formattedMessages.length === 0) {
      logger.error('[OpenAIProvider] Formatted messages are empty:', messages);
      throw new Error('Valid messages are required');
    }

    logger.info('[OpenAIProvider] Sending messages:', JSON.stringify(formattedMessages, null, 2));

    // Configure OpenAI API request options
    const completionOptions: OpenAI.Chat.ChatCompletionCreateParams = {
      model: model || this.options.model,
      messages: formattedMessages,
      temperature: options?.temperature ?? this.options.temperature,
      max_tokens: options?.maxTokens ?? this.options.maxTokens
    };

    // Add tool provider functions
    if (options?.tools && Array.isArray(options.tools)) {
      completionOptions.tools = this.formatFunctions(options.tools);
    }

    // Set response format if specified
    if (this.options.responseFormat) {
      completionOptions.response_format = {
        type: this.options.responseFormat as any
      };
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
   * Model chat streaming request
   */
  async *chatStream(model: string, context: Context, options?: any): AsyncGenerator<StreamingResponseChunk, void, unknown> {
    if (!context || typeof context !== 'object') {
      logger.error('[OpenAIProvider] Invalid context:', context);
      throw new Error('Valid Context object is required');
    }

    const { messages, systemPrompt } = context;

    if (!Array.isArray(messages)) {
      logger.error('[OpenAIProvider] Invalid message array:', messages);
      throw new Error('Valid message array is required');
    }

    // Convert UniversalMessage[] to OpenAI format
    let formattedMessages: OpenAI.Chat.ChatCompletionMessageParam[];

    try {
      formattedMessages = OpenAIConversationAdapter.toOpenAIFormat(messages as UniversalMessage[]);

      // Add system prompt if needed
      formattedMessages = OpenAIConversationAdapter.addSystemPromptIfNeeded(formattedMessages, systemPrompt);
    } catch (error) {
      logger.error('[OpenAIProvider] Streaming message conversion error:', error);
      throw new Error('Failed to convert message format');
    }

    if (formattedMessages.length === 0) {
      logger.error('[OpenAIProvider] Formatted messages are empty:', messages);
      throw new Error('Valid messages are required');
    }

    logger.info('[OpenAIProvider] Starting streaming request:', JSON.stringify(formattedMessages, null, 2));

    // Configure OpenAI API request options
    const completionOptions: OpenAI.Chat.ChatCompletionCreateParams = {
      model: model || this.options.model,
      messages: formattedMessages,
      temperature: options?.temperature ?? this.options.temperature,
      max_tokens: options?.maxTokens ?? this.options.maxTokens,
      stream: true
    };

    // Add tool provider functions
    if (options?.tools && Array.isArray(options.tools)) {
      completionOptions.tools = this.formatFunctions(options.tools);
    }

    // Set response format if specified
    if (this.options.responseFormat) {
      completionOptions.response_format = {
        type: this.options.responseFormat as any
      };
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
   * Release resources (if needed)
   */
  async close(): Promise<void> {
    // OpenAI client does not have special close method, so implement as empty function
  }
} 
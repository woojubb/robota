import OpenAI from 'openai';
import {
  Context,
  ModelResponse,
  StreamingResponseChunk,
  BaseAIProvider,
  ToolSchema,
  logger
} from '@robota-sdk/agents';
import type { UniversalMessage } from '@robota-sdk/agents/src/managers/conversation-history-manager';
import type { ProviderExecutionResult } from '@robota-sdk/agents/src/abstracts/base-ai-provider';
import { OpenAIProviderOptions } from './types';
import { OpenAIConversationAdapter } from './adapter';
import { PayloadLogger } from './payload-logger';
// import { OpenAIStreamHandler } from './streaming/stream-handler';
// import { OpenAIResponseParser } from './parsers/response-parser';

/**
 * OpenAI AI provider implementation for Robota
 * 
 * Provides integration with OpenAI's GPT models and other services.
 * Extends BaseAIProvider for common functionality and tool calling support.
 * 
 * @see {@link @examples/03-integrations | Provider Integration Examples}
 * 
 * @public
 */
export class OpenAIProvider extends BaseAIProvider {
  /**
   * Provider identifier name
   * @readonly
   */
  public readonly name: string = 'openai';

  /**
   * Available models
   * @readonly
   */
  public readonly models: string[] = [
    'gpt-4',
    'gpt-4-turbo',
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-3.5-turbo',
    'gpt-3.5-turbo-16k'
  ];

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
   * Payload logger for API request logging
   * @internal
   */
  private readonly payloadLogger: PayloadLogger;

  // /**
  //  * Stream handler for OpenAI streaming responses
  //  * @internal
  //  */
  // private readonly streamHandler: OpenAIStreamHandler;

  /**
   * Create a new OpenAI provider instance
   * 
   * @param options - Configuration options for the OpenAI provider
   * 
   * @throws {Error} When client is not provided in options
   */
  constructor(options: OpenAIProviderOptions) {
    super();

    this.options = {
      temperature: 0.7,
      // Set default values for parallel tool call options
      enableParallelToolCalls: true,
      maxConcurrentToolCalls: 3,
      toolCallDelayMs: 100,
      ...options
    };

    // Validate required client injection
    if (!options.client) {
      throw new Error('OpenAI client is not injected. The client option is required.');
    }

    this.client = options.client;
    this.instance = options.client; // Maintain backwards compatibility

    // Initialize payload logger
    this.payloadLogger = new PayloadLogger(
      this.options.enablePayloadLogging || false,
      this.options.payloadLogDir || './logs/api-payloads',
      this.options.includeTimestampInLogFiles !== false
    );

    // Initialize stream handler
    // this.streamHandler = new OpenAIStreamHandler(this.client, this.payloadLogger);
  }

  /**
   * Convert tool definitions to OpenAI tool format
   * 
   * Transforms universal tool definitions into OpenAI's specific tool format
   * required by the Chat Completions API.
   * 
   * @param tools - Array of universal tool definitions
   * @returns Array of OpenAI-formatted tools
   */
  formatFunctions(tools: ToolSchema[]): OpenAI.Chat.ChatCompletionTool[] {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: tool.parameters
      }
    }));
  }

  /**
   * Convert UniversalMessage[] to OpenAI-specific message format
   * 
   * @param messages - Array of UniversalMessage to convert
   * @returns OpenAI-formatted messages array
   */
  protected override convertMessages(messages: UniversalMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
    return OpenAIConversationAdapter.toOpenAIFormat(messages);
  }

  /**
   * Configure tools for OpenAI API request
   * 
   * Transforms tool schemas into OpenAI tool format and sets tool_choice.
   * 
   * @param tools - Array of tool schemas
   * @returns OpenAI tool configuration object
   */
  protected override configureTools(tools?: ToolSchema[]): { tools: OpenAI.Chat.ChatCompletionTool[], tool_choice: 'auto' } | undefined {
    if (!tools || !Array.isArray(tools)) {
      return undefined;
    }

    return {
      tools: this.formatFunctions(tools),
      tool_choice: 'auto' // Force new tool_calls format
    };
  }

  /**
   * Generate response using raw request payload (for agents package compatibility)
   * 
   * This method is required by the agents package's ConversationService.
   * It adapts the raw request payload to the OpenAI API format.
   * 
   * @param request - Raw request payload from ConversationService
   * @returns Promise resolving to OpenAI API response
   */
  override async generateResponse(request: any): Promise<any> {
    try {
      // Extract parameters from request payload
      const model = request.model;
      const messages = request.messages || [];
      const temperature = request.temperature;
      const maxTokens = request.max_tokens;
      const tools = request.tools;

      // Create context for chat method
      const context: Context = {
        messages,
        tools
      };

      // Create options object
      const options = {
        temperature,
        maxTokens
      };

      // Use existing chat method
      const response = await this.chat(model, context, options);

      // Return response in expected format for ConversationService
      return {
        content: response.content,
        message: { content: response.content },
        tool_calls: response.toolCalls,
        toolCalls: response.toolCalls,
        usage: response.usage,
        finish_reason: response.metadata?.finishReason,
        finishReason: response.metadata?.finishReason,
        metadata: response.metadata
      };

    } catch (error) {
      this.handleApiError(error, 'generateResponse');
    }
  }

  /**
   * Generate streaming response using raw request payload (for agents package compatibility)
   * 
   * This method is required by the agents package's ConversationService for streaming.
   * It adapts the raw request payload to the OpenAI streaming API format.
   * 
   * @param request - Raw request payload from ConversationService
   * @returns AsyncGenerator yielding streaming response chunks
   */
  override async *generateStreamingResponse(request: any): AsyncGenerator<any, void, unknown> {
    try {
      // Extract parameters from request payload
      const model = request.model;
      const messages = request.messages || [];
      const temperature = request.temperature;
      const maxTokens = request.max_tokens;
      const tools = request.tools;

      // Create context for chatStream method
      const context: Context = {
        messages,
        tools
      };

      // Create options object
      const options = {
        temperature,
        maxTokens
      };

      // Use existing chatStream method
      for await (const chunk of this.chatStream(model, context, options)) {
        // Return chunk in expected format for ConversationService
        yield {
          content: chunk.content,
          delta: { content: chunk.content },
          isComplete: chunk.isComplete,
          toolCall: chunk.toolCall
        };
      }

    } catch (error) {
      this.handleApiError(error, 'generateStreamingResponse');
    }
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
    // Use base class validation
    this.validateContext(context);

    // Convert messages for OpenAI API
    const openaiMessages = this.convertMessages(context.messages);

    const completionOptions: OpenAI.Chat.ChatCompletionCreateParams = {
      model,
      messages: openaiMessages,
      max_tokens: options?.maxTokens || this.options.maxTokens,
      temperature: options?.temperature || this.options.temperature,
    };

    // Configure tools if provided
    const toolConfig = this.configureTools(context.tools);
    if (toolConfig) {
      completionOptions.tools = toolConfig.tools;
      completionOptions.tool_choice = toolConfig.tool_choice;
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
      // Log payload if enabled
      await this.payloadLogger.logPayload(completionOptions, 'chat');

      const response = await this.client.chat.completions.create(completionOptions);
      return this.parseResponse(response);
    } catch (error) {
      this.handleApiError(error, 'chat');
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
    const message = response.choices?.[0]?.message;
    if (!message) {
      throw new Error('No message found in OpenAI response');
    }

    const result: ModelResponse = {
      content: message.content || '',
      metadata: {
        model: response.model,
        ...(response.choices[0]?.finish_reason && { finishReason: response.choices[0].finish_reason }),
        ...(response.system_fingerprint && { systemFingerprint: response.system_fingerprint })
      }
    };

    // Add usage if available
    if (response.usage) {
      result.usage = {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens
      };
    }

    // Handle tool calls
    if (message.tool_calls && message.tool_calls.length > 0) {
      result.toolCalls = message.tool_calls.map(toolCall => ({
        id: toolCall.id,
        type: 'function' as const,
        function: {
          name: toolCall.function.name,
          arguments: toolCall.function.arguments
        }
      }));
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
    const choice = chunk.choices?.[0];
    if (!choice) {
      return { content: '', isComplete: false };
    }

    const delta = choice.delta;
    const result: StreamingResponseChunk = {
      content: delta.content || '',
      isComplete: choice.finish_reason !== null
    };

    // Handle tool call chunks
    if (delta.tool_calls && delta.tool_calls.length > 0) {
      const toolCall = delta.tool_calls[0];
      if (toolCall && toolCall.type === 'function' && toolCall.function) {
        result.toolCall = {
          type: 'function',
          function: {
            name: toolCall.function.name || '',
            arguments: toolCall.function.arguments || ''
          }
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
   * @see {@link @examples/01-basic | Basic Usage Examples}
   */
  override async *chatStream(model: string, context: Context, options?: any): AsyncGenerator<StreamingResponseChunk, void, unknown> {
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

    const completionOptions: OpenAI.Chat.ChatCompletionCreateParams = {
      model,
      messages: openaiMessages,
      max_tokens: options?.maxTokens || this.options.maxTokens,
      temperature: options?.temperature || this.options.temperature,
      stream: true
    };

    // Add tool provider functions
    if (context.tools && Array.isArray(context.tools)) {
      completionOptions.tools = this.formatFunctions(context.tools);
      // Force new tool_calls format by setting tool_choice
      completionOptions.tool_choice = 'auto';
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
      // Log payload if enabled
      await this.payloadLogger.logPayload(completionOptions, 'stream');

      const stream = await this.client.chat.completions.create(completionOptions);

      for await (const chunk of stream) {
        yield this.parseStreamingChunk(chunk);
      }
    } catch (error) {
      logger.error('[OpenAIProvider] Streaming API call error:', {
        error: error instanceof Error ? error.message : String(error)
      });
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
  override async close(): Promise<void> {
    // OpenAI client doesn't have explicit close method
    // This is implemented as no-op for interface compliance
  }

  /**
   * Process OpenAI provider response into standardized format
   * 
   * Overrides the base implementation to use OpenAI-specific parsing logic.
   * 
   * @param response - Raw response from OpenAI chat method
   * @returns Standardized ProviderExecutionResult
   */
  protected override processResponse(response: ModelResponse): ProviderExecutionResult {
    return {
      content: response.content || '',
      toolCalls: response.toolCalls || [],
      usage: response.usage || {},
      finishReason: response.metadata?.finishReason || '',
      metadata: response.metadata || {}
    };
  }
} 
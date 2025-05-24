import OpenAI from 'openai';
import {
  Context,
  FunctionDefinition,
  Message,
  ModelResponse,
  StreamingResponseChunk,
  AIProvider,
  UniversalMessage
} from '@robota-sdk/core';
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
      logger.error('[OpenAIProvider] 유효하지 않은 컨텍스트:', context);
      throw new Error('유효한 Context 객체가 필요합니다');
    }

    const { messages, systemPrompt } = context;

    if (!Array.isArray(messages)) {
      logger.error('[OpenAIProvider] 유효하지 않은 메시지 배열:', messages);
      throw new Error('유효한 메시지 배열이 필요합니다');
    }

    // UniversalMessage[]를 OpenAI 형식으로 변환
    let formattedMessages: OpenAI.Chat.ChatCompletionMessageParam[];

    try {
      formattedMessages = OpenAIConversationAdapter.toOpenAIFormat(messages as UniversalMessage[]);

      // 시스템 프롬프트 추가 (필요한 경우)
      formattedMessages = OpenAIConversationAdapter.addSystemPromptIfNeeded(formattedMessages, systemPrompt);
    } catch (error) {
      logger.error('[OpenAIProvider] 메시지 변환 오류:', error);
      throw new Error('메시지 형식 변환에 실패했습니다');
    }

    if (formattedMessages.length === 0) {
      logger.error('[OpenAIProvider] 포맷된 메시지가 비어있습니다:', messages);
      throw new Error('유효한 메시지가 필요합니다');
    }

    logger.info('[OpenAIProvider] 메시지 전송:', JSON.stringify(formattedMessages, null, 2));

    // OpenAI API 요청 옵션 구성
    const completionOptions: OpenAI.Chat.ChatCompletionCreateParams = {
      model: model || this.options.model,
      messages: formattedMessages,
      temperature: options?.temperature ?? this.options.temperature,
      max_tokens: options?.maxTokens ?? this.options.maxTokens
    };

    // 도구 제공자 함수 추가
    if (options?.tools && Array.isArray(options.tools)) {
      completionOptions.tools = this.formatFunctions(options.tools);
    }

    // 응답 형식이 지정된 경우
    if (this.options.responseFormat) {
      completionOptions.response_format = {
        type: this.options.responseFormat as any
      };
    }

    try {
      logger.info('[OpenAIProvider] API 요청 옵션:', JSON.stringify(completionOptions, null, 2));
      const response = await this.client.chat.completions.create(completionOptions);
      return this.parseResponse(response);
    } catch (error) {
      logger.error('[OpenAIProvider] API 호출 오류:', error);
      throw error;
    }
  }

  /**
   * 모델 채팅 스트리밍 요청
   */
  async *chatStream(model: string, context: Context, options?: any): AsyncGenerator<StreamingResponseChunk, void, unknown> {
    if (!context || typeof context !== 'object') {
      logger.error('[OpenAIProvider] 유효하지 않은 컨텍스트:', context);
      throw new Error('유효한 Context 객체가 필요합니다');
    }

    const { messages, systemPrompt } = context;

    if (!Array.isArray(messages)) {
      logger.error('[OpenAIProvider] 유효하지 않은 메시지 배열:', messages);
      throw new Error('유효한 메시지 배열이 필요합니다');
    }

    // UniversalMessage[]를 OpenAI 형식으로 변환
    let formattedMessages: OpenAI.Chat.ChatCompletionMessageParam[];

    try {
      formattedMessages = OpenAIConversationAdapter.toOpenAIFormat(messages as UniversalMessage[]);

      // 시스템 프롬프트 추가 (필요한 경우)
      formattedMessages = OpenAIConversationAdapter.addSystemPromptIfNeeded(formattedMessages, systemPrompt);
    } catch (error) {
      logger.error('[OpenAIProvider] 스트리밍 메시지 변환 오류:', error);
      throw new Error('메시지 형식 변환에 실패했습니다');
    }

    if (formattedMessages.length === 0) {
      logger.error('[OpenAIProvider] 포맷된 메시지가 비어있습니다:', messages);
      throw new Error('유효한 메시지가 필요합니다');
    }

    logger.info('[OpenAIProvider] 스트리밍 요청 시작:', JSON.stringify(formattedMessages, null, 2));

    // OpenAI API 요청 옵션 구성
    const completionOptions: OpenAI.Chat.ChatCompletionCreateParams = {
      model: model || this.options.model,
      messages: formattedMessages,
      temperature: options?.temperature ?? this.options.temperature,
      max_tokens: options?.maxTokens ?? this.options.maxTokens,
      stream: true
    };

    // 도구 제공자 함수 추가
    if (options?.tools && Array.isArray(options.tools)) {
      completionOptions.tools = this.formatFunctions(options.tools);
    }

    // 응답 형식이 지정된 경우
    if (this.options.responseFormat) {
      completionOptions.response_format = {
        type: this.options.responseFormat as any
      };
    }

    try {
      logger.info('[OpenAIProvider] 스트리밍 API 요청 옵션:', JSON.stringify({
        ...completionOptions,
        stream: true
      }, null, 2));

      const stream = await this.client.chat.completions.create(completionOptions);

      for await (const chunk of stream) {
        yield this.parseStreamingChunk(chunk);
      }
    } catch (error) {
      logger.error('[OpenAIProvider] 스트리밍 API 호출 오류:', error);
      throw error;
    }
  }

  /**
   * 리소스 해제 (필요시)
   */
  async close(): Promise<void> {
    // OpenAI 클라이언트는 특별한 종료 메서드가 없으므로 빈 함수로 구현
  }
} 
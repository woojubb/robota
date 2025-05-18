import OpenAI from 'openai';
import {
  Context,
  FunctionDefinition,
  Message,
  ModelResponse,
  StreamingResponseChunk,
  removeUndefined
} from '@robota-sdk/core';
import { ModelContextProtocol } from '@robota-sdk/core';
import { OpenAIProviderOptions } from './types';
import { logger } from '@robota-sdk/core';

/**
 * OpenAI 제공업체 구현
 */
export class OpenAIProvider implements ModelContextProtocol {
  /**
   * OpenAI 클라이언트 인스턴스
   */
  private client: OpenAI;

  /**
   * 제공업체 옵션
   */
  public options: OpenAIProviderOptions;

  constructor(options: OpenAIProviderOptions) {
    this.options = {
      temperature: 0.7,
      maxTokens: undefined,
      ...options
    };

    // 클라이언트가 주입되지 않았으면 에러 발생
    if (!options.client) {
      throw new Error('OpenAI 클라이언트가 주입되지 않았습니다. client 옵션은 필수입니다.');
    }

    this.client = options.client;
  }

  /**
   * 메시지를 OpenAI 형식으로 변환
   */
  formatMessages(messages: Message[]): OpenAI.Chat.ChatCompletionMessageParam[] {
    if (!Array.isArray(messages)) {
      logger.error('formatMessages: messages는 배열이어야 합니다.', messages);
      return [];
    }

    const formattedMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    for (const message of messages) {
      if (!message || typeof message !== 'object') {
        logger.error('formatMessages: 유효하지 않은 메시지 형식', message);
        continue;
      }

      const { role, content, name, functionCall } = message;

      // 함수 호출 결과가 있는 경우
      if (role === 'function') {
        formattedMessages.push({
          role: 'function',
          name: name || '',
          content: typeof content === 'string' ? content : JSON.stringify(content)
        });
        continue;
      }

      // 함수 호출이 있는 경우
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

      // 일반 메시지
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
   * 함수 정의를 OpenAI 형식으로 변환
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
   * OpenAI API 응답을 표준 형식으로 변환
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

    // 함수 호출이 있는 경우
    if (message.function_call) {
      result.functionCall = {
        name: message.function_call.name,
        arguments: message.function_call.arguments
      };
    }

    return result;
  }

  /**
   * 스트리밍 응답 청크를 표준 형식으로 변환
   */
  parseStreamingChunk(chunk: OpenAI.Chat.ChatCompletionChunk): StreamingResponseChunk {
    const delta = chunk.choices[0].delta;

    const result: StreamingResponseChunk = {
      content: delta.content || undefined,
      isComplete: chunk.choices[0].finish_reason !== null
    };

    // 함수 호출 청크가 있는 경우
    if (delta.function_call) {
      result.functionCall = {
        name: delta.function_call.name,
        arguments: delta.function_call.arguments
      };
    }

    return result;
  }

  /**
   * 모델 채팅 요청
   */
  async chat(context: Context, options?: any): Promise<ModelResponse> {
    if (!context || typeof context !== 'object') {
      logger.error('[OpenAIProvider] 유효하지 않은 컨텍스트:', context);
      throw new Error('유효한 Context 객체가 필요합니다');
    }

    const { messages, systemPrompt } = context;

    if (!Array.isArray(messages)) {
      logger.error('[OpenAIProvider] 유효하지 않은 메시지 배열:', messages);
      throw new Error('유효한 메시지 배열이 필요합니다');
    }

    // 시스템 프롬프트 추가 (없는 경우)
    const messagesWithSystem = systemPrompt && !messages.some(m => m.role === 'system')
      ? [{ role: 'system' as const, content: systemPrompt }, ...messages]
      : messages;

    const formattedMessages = this.formatMessages(messagesWithSystem);

    if (formattedMessages.length === 0) {
      logger.error('[OpenAIProvider] 포맷된 메시지가 비어있습니다:', messagesWithSystem);
      throw new Error('유효한 메시지가 필요합니다');
    }

    logger.info('[OpenAIProvider] 메시지 전송:', JSON.stringify(formattedMessages, null, 2));

    // OpenAI API 요청 옵션 구성
    const completionOptions: OpenAI.Chat.ChatCompletionCreateParams = {
      model: this.options.model,
      messages: formattedMessages,
      temperature: options?.temperature ?? this.options.temperature,
      max_tokens: options?.maxTokens ?? this.options.maxTokens
    };

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
  async *chatStream(context: Context, options?: any): AsyncGenerator<StreamingResponseChunk, void, unknown> {
    if (!context || typeof context !== 'object') {
      logger.error('[OpenAIProvider] 유효하지 않은 컨텍스트:', context);
      throw new Error('유효한 Context 객체가 필요합니다');
    }

    const { messages, systemPrompt } = context;

    if (!Array.isArray(messages)) {
      logger.error('[OpenAIProvider] 유효하지 않은 메시지 배열:', messages);
      throw new Error('유효한 메시지 배열이 필요합니다');
    }

    // 시스템 프롬프트 추가 (없는 경우)
    const messagesWithSystem = systemPrompt && !messages.some(m => m.role === 'system')
      ? [{ role: 'system' as const, content: systemPrompt }, ...messages]
      : messages;

    const formattedMessages = this.formatMessages(messagesWithSystem);

    if (formattedMessages.length === 0) {
      logger.error('[OpenAIProvider] 포맷된 메시지가 비어있습니다:', messagesWithSystem);
      throw new Error('유효한 메시지가 필요합니다');
    }

    logger.info('[OpenAIProvider] 스트리밍 요청 시작:', JSON.stringify(formattedMessages, null, 2));

    // OpenAI API 요청 옵션 구성
    const completionOptions: OpenAI.Chat.ChatCompletionCreateParams = {
      model: this.options.model,
      messages: formattedMessages,
      temperature: options?.temperature ?? this.options.temperature,
      max_tokens: options?.maxTokens ?? this.options.maxTokens,
      stream: true
    };

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

      // @ts-ignore - OpenAI 스트림 타입 처리가 필요합니다
      for await (const chunk of stream) {
        yield this.parseStreamingChunk(chunk);
      }
    } catch (error) {
      logger.error('[OpenAIProvider] 스트리밍 API 호출 오류:', error);
      throw error;
    }
  }
} 
import { randomUUID } from 'node:crypto';
import type OpenAI from 'openai';
import type { ILogger, TUniversalMessage } from '@robota-sdk/agent-core';
import { SilentLogger } from '@robota-sdk/agent-core';
import type { TOpenAICompatibleTextProjector } from './types';

export interface IOpenAICompatibleResponseParserOptions {
  logger?: ILogger;
  textProjector?: TOpenAICompatibleTextProjector;
}

export class OpenAICompatibleResponseParser {
  private readonly logger: ILogger;
  private readonly textProjector?: TOpenAICompatibleTextProjector;

  constructor(options: IOpenAICompatibleResponseParserOptions = {}) {
    this.logger = options.logger ?? SilentLogger;
    this.textProjector = options.textProjector;
  }

  parseResponse(response: OpenAI.Chat.ChatCompletion): TUniversalMessage {
    try {
      const choice = response.choices?.[0];
      if (!choice) {
        throw new Error('No choices found in OpenAI-compatible response');
      }

      const message = choice.message;
      const content = this.projectText(message.content || '');
      const toolCalls =
        message.tool_calls?.map((toolCall) => ({
          id: toolCall.id,
          type: 'function' as const,
          function: {
            name: toolCall.function.name,
            arguments: toolCall.function.arguments,
          },
        })) || [];
      const usage = response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined;

      return {
        id: randomUUID(),
        state: 'complete',
        role: 'assistant',
        content,
        timestamp: new Date(),
        ...(toolCalls.length > 0 && { toolCalls }),
        ...(usage && { usage }),
        metadata: {
          finishReason: choice.finish_reason || undefined,
        },
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'OpenAI-compatible response parsing failed';
      this.logger.error('Response parsing failed', { error: message });
      throw new Error(`OpenAI-compatible response parsing failed: ${message}`);
    }
  }

  parseStreamingChunk(chunk: OpenAI.Chat.ChatCompletionChunk): TUniversalMessage | null {
    try {
      const choice = chunk.choices?.[0];
      if (!choice) {
        return null;
      }

      const finishReason = choice.finish_reason;
      const toolCalls = choice.delta.tool_calls?.map((toolCall) => ({
        id: toolCall.id || '',
        type: 'function' as const,
        function: {
          name: toolCall.function?.name || '',
          arguments: toolCall.function?.arguments || '',
        },
      }));

      if (toolCalls) {
        return {
          id: randomUUID(),
          state: 'complete',
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          toolCalls,
          metadata: {
            isStreamChunk: true,
            isComplete: finishReason === 'stop' || finishReason === 'tool_calls',
          },
        };
      }

      return {
        id: randomUUID(),
        state: 'complete',
        role: 'assistant',
        content: this.projectText(choice.delta.content || ''),
        timestamp: new Date(),
        metadata: {
          isStreamChunk: true,
          isComplete: finishReason === 'stop' || finishReason === 'tool_calls',
        },
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'OpenAI-compatible chunk parsing failed';
      this.logger.error('Chunk parsing failed', { error: message });
      throw new Error(`OpenAI-compatible chunk parsing failed: ${message}`);
    }
  }

  private projectText(text: string): string {
    return this.textProjector ? this.textProjector(text) : text;
  }
}

import { randomUUID } from 'node:crypto';
import type OpenAI from 'openai';
import type { ILogger, IToolCall, TUniversalMessage } from '@robota-sdk/agent-core';
import { SilentLogger } from '@robota-sdk/agent-core';
import type {
  IOpenAICompatibleToolCallTextProjector,
  IOpenAICompatibleToolCallTextProjection,
  TOpenAICompatibleTextProjector,
} from './types';

export interface IOpenAICompatibleResponseParserOptions {
  logger?: ILogger;
  textProjector?: TOpenAICompatibleTextProjector;
  toolCallTextProjector?: IOpenAICompatibleToolCallTextProjector;
}

export class OpenAICompatibleResponseParser {
  private readonly logger: ILogger;
  private readonly textProjector?: TOpenAICompatibleTextProjector;
  private readonly toolCallTextProjector?: IOpenAICompatibleToolCallTextProjector;

  constructor(options: IOpenAICompatibleResponseParserOptions = {}) {
    this.logger = options.logger ?? SilentLogger;
    this.textProjector = options.textProjector;
    this.toolCallTextProjector = options.toolCallTextProjector;
  }

  parseResponse(response: OpenAI.Chat.ChatCompletion): TUniversalMessage {
    try {
      const choice = response.choices?.[0];
      if (!choice) {
        throw new Error('No choices found in OpenAI-compatible response');
      }

      return this.parseChoice(choice, response.usage);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'OpenAI-compatible response parsing failed';
      this.logger.error('Response parsing failed', { error: message });
      throw new Error(`OpenAI-compatible response parsing failed: ${message}`);
    }
  }

  private parseChoice(
    choice: OpenAI.Chat.ChatCompletion.Choice,
    usage: OpenAI.CompletionUsage | undefined,
  ): TUniversalMessage {
    const message = choice.message;
    const toolTextProjection = this.projectToolCallText(message.content || '');
    const toolTextFlush = this.toolCallTextProjector?.flush();
    const nativeToolCalls = this.parseNativeToolCalls(message);
    const projectedToolCalls = [
      ...toolTextProjection.toolCalls,
      ...(toolTextFlush?.toolCalls ?? []),
    ];
    const toolCalls = [...nativeToolCalls, ...projectedToolCalls];

    return {
      id: randomUUID(),
      state: 'complete',
      role: 'assistant',
      content: this.projectText(
        toolTextProjection.visibleText + (toolTextFlush?.visibleText ?? ''),
      ),
      timestamp: new Date(),
      ...(toolCalls.length > 0 && { toolCalls }),
      ...(usage && { usage: this.parseUsage(usage) }),
      metadata: {
        finishReason: choice.finish_reason || undefined,
        ...this.buildToolTextMetadata(toolTextProjection, toolTextFlush),
      },
    };
  }

  private parseNativeToolCalls(message: OpenAI.Chat.ChatCompletionMessage): IToolCall[] {
    return (
      message.tool_calls?.map((toolCall) => ({
        id: toolCall.id,
        type: 'function' as const,
        function: {
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        },
      })) || []
    );
  }

  private parseUsage(usage: OpenAI.CompletionUsage): {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } {
    return {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    };
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

  private projectToolCallText(text: string): IOpenAICompatibleToolCallTextProjection {
    return (
      this.toolCallTextProjector?.project(text) ?? {
        visibleText: text,
        toolCalls: [],
        removedToolCallText: false,
      }
    );
  }

  private buildToolTextMetadata(
    projection: IOpenAICompatibleToolCallTextProjection,
    flush: IOpenAICompatibleToolCallTextProjection | undefined,
  ): Record<string, string | boolean | undefined> {
    const rawToolCallText = [projection.rawToolCallText, flush?.rawToolCallText]
      .filter((text): text is string => typeof text === 'string' && text.length > 0)
      .join('');
    const removedToolCallText =
      projection.removedToolCallText || (flush?.removedToolCallText ?? false);

    return {
      ...(removedToolCallText && { toolCallTextProjected: true }),
      ...(rawToolCallText.length > 0 && { rawToolCallText }),
    };
  }
}

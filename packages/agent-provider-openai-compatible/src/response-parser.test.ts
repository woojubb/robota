import { describe, expect, it } from 'vitest';
import type OpenAI from 'openai';
import { OpenAICompatibleResponseParser } from './index';

describe('OpenAICompatibleResponseParser', () => {
  it('parses full chat completion responses into universal assistant messages', () => {
    const parser = new OpenAICompatibleResponseParser();
    const response: OpenAI.Chat.ChatCompletion = {
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 1,
      model: 'local-model',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Visible answer',
            refusal: null,
          },
          finish_reason: 'stop',
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: 3,
        completion_tokens: 4,
        total_tokens: 7,
      },
    };

    const result = parser.parseResponse(response);

    expect(result.role).toBe('assistant');
    if (result.role !== 'assistant') throw new Error('Expected assistant message');
    expect(result.content).toBe('Visible answer');
    expect(result).toHaveProperty('usage');
    const withUsage = result as unknown as {
      usage: { promptTokens: number; completionTokens: number; totalTokens: number };
    };
    expect(withUsage.usage).toEqual({
      promptTokens: 3,
      completionTokens: 4,
      totalTokens: 7,
    });
    expect(result.metadata?.['finishReason']).toBe('stop');
  });

  it('applies an injected provider-owned text tool-call projector to full responses', () => {
    const parser = new OpenAICompatibleResponseParser({
      toolCallTextProjector: {
        project: (text: string) => ({
          visibleText: text === 'provider native payload' ? '' : text,
          toolCalls:
            text === 'provider native payload'
              ? [
                  {
                    id: 'projected-call-1',
                    type: 'function' as const,
                    function: { name: 'InjectedTool', arguments: '{"value":"ok"}' },
                  },
                ]
              : [],
          removedToolCallText: text === 'provider native payload',
          ...(text === 'provider native payload' && { rawToolCallText: text }),
        }),
        flush: () => ({
          visibleText: '',
          toolCalls: [],
          removedToolCallText: false,
        }),
      },
    });
    const response: OpenAI.Chat.ChatCompletion = {
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 1,
      model: 'local-model',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'provider native payload',
            refusal: null,
          },
          finish_reason: 'tool_calls',
          logprobs: null,
        },
      ],
    };

    const result = parser.parseResponse(response);

    expect(result.content).toBe('');
    expect(result.metadata?.['toolCallTextProjected']).toBe(true);
    expect(result.metadata?.['rawToolCallText']).toBe('provider native payload');
    if (result.role !== 'assistant') throw new Error('Expected assistant message');
    expect(result.toolCalls).toEqual([
      {
        id: 'projected-call-1',
        type: 'function',
        function: { name: 'InjectedTool', arguments: '{"value":"ok"}' },
      },
    ]);
  });

  it('applies text projection while parsing streaming chunks', () => {
    const parser = new OpenAICompatibleResponseParser({
      textProjector: (text) => text.replace('[hidden]', ''),
    });
    const chunk: OpenAI.Chat.ChatCompletionChunk = {
      id: 'chunk-1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'local-model',
      choices: [
        {
          index: 0,
          delta: { content: '[hidden]Visible' },
          finish_reason: null,
          logprobs: null,
        },
      ],
    };

    const result = parser.parseStreamingChunk(chunk);

    expect(result?.content).toBe('Visible');
    expect(result?.metadata?.['isStreamChunk']).toBe(true);
  });
});

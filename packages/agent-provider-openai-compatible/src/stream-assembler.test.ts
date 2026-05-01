import { describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import { assembleOpenAICompatibleStream } from './index';

async function* asyncIterableFrom<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

function createHangingChunkStream(
  onReturn: () => void,
): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<OpenAI.Chat.ChatCompletionChunk> {
      return {
        next: () => new Promise<IteratorResult<OpenAI.Chat.ChatCompletionChunk>>(() => {}),
        return: () => {
          onReturn();
          return Promise.resolve({
            done: true,
            value: createChunk(''),
          });
        },
      };
    },
  };
}

function createChunk(
  content: string,
  finishReason: OpenAI.Chat.ChatCompletionChunk.Choice['finish_reason'] = null,
): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: 'chunk-1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'local-model',
    choices: [
      {
        index: 0,
        delta: { content },
        finish_reason: finishReason,
        logprobs: null,
      },
    ],
  };
}

describe('assembleOpenAICompatibleStream', () => {
  it('assembles text deltas and emits projected text deltas', async () => {
    const onTextDelta = vi.fn();
    const projector = vi.fn((text: string) => text.replaceAll('[hidden]', ''));

    const result = await assembleOpenAICompatibleStream({
      stream: asyncIterableFrom([
        createChunk('Hello '),
        createChunk('[hidden]world'),
        createChunk('', 'stop'),
      ]),
      onTextDelta,
      textProjector: projector,
    });

    expect(result.role).toBe('assistant');
    expect(result.content).toBe('Hello world');
    expect(result.metadata?.['model']).toBe('local-model');
    expect(result.metadata?.['finishReason']).toBe('stop');
    expect(onTextDelta).toHaveBeenCalledTimes(2);
    expect(onTextDelta).toHaveBeenNthCalledWith(1, 'Hello ');
    expect(onTextDelta).toHaveBeenNthCalledWith(2, 'world');
  });

  it('assembles streamed tool call deltas by index', async () => {
    const stream = asyncIterableFrom<OpenAI.Chat.ChatCompletionChunk>([
      {
        id: 'chunk-1',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'local-model',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'search', arguments: '{"q"' },
                },
              ],
            },
            finish_reason: null,
            logprobs: null,
          },
        ],
      },
      {
        id: 'chunk-2',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'local-model',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: ':"docs"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
            logprobs: null,
          },
        ],
      },
    ]);

    const result = await assembleOpenAICompatibleStream({ stream });

    expect(result.role).toBe('assistant');
    if (result.role !== 'assistant') throw new Error('Expected assistant message');
    expect(result.toolCalls).toEqual([
      {
        id: 'call-1',
        type: 'function',
        function: { name: 'search', arguments: '{"q":"docs"}' },
      },
    ]);
  });

  it('applies an injected provider-owned text tool-call projector before text deltas', async () => {
    const onTextDelta = vi.fn();
    const projector = {
      project: vi.fn((delta: string) => {
        if (delta === 'provider native payload') {
          return {
            visibleText: '',
            toolCalls: [
              {
                id: 'projected-call-1',
                type: 'function' as const,
                function: { name: 'InjectedTool', arguments: '{"value":"ok"}' },
              },
            ],
            removedToolCallText: true,
            rawToolCallText: delta,
          };
        }

        return {
          visibleText: delta,
          toolCalls: [],
          removedToolCallText: false,
        };
      }),
      flush: vi.fn(() => ({
        visibleText: '',
        toolCalls: [],
        removedToolCallText: false,
      })),
    };

    const result = await assembleOpenAICompatibleStream({
      stream: asyncIterableFrom([
        createChunk('provider native payload'),
        createChunk('visible', 'tool_calls'),
      ]),
      onTextDelta,
      toolCallTextProjector: projector,
    });

    expect(onTextDelta).toHaveBeenCalledOnce();
    expect(onTextDelta).toHaveBeenCalledWith('visible');
    expect(result.content).toBe('visible');
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

  it('flushes projector-held text after the stream ends', async () => {
    const onTextDelta = vi.fn();

    const result = await assembleOpenAICompatibleStream({
      stream: asyncIterableFrom([createChunk('Visible'), createChunk('', 'stop')]),
      onTextDelta,
      textProjector: (text) => text.slice(0, -1),
      textProjectorFlush: () => 'e',
    });

    expect(result.content).toBe('Visible');
    expect(onTextDelta).toHaveBeenNthCalledWith(1, 'Visibl');
    expect(onTextDelta).toHaveBeenNthCalledWith(2, 'e');
  });

  it('settles when aborted while awaiting the next stream chunk', async () => {
    const controller = new AbortController();
    let returned = false;
    const resultPromise = assembleOpenAICompatibleStream({
      stream: createHangingChunkStream(() => {
        returned = true;
      }),
      signal: controller.signal,
    });

    setTimeout(() => controller.abort(), 0);
    const result = await Promise.race([
      resultPromise,
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('stream abort did not settle')), 100),
      ),
    ]);

    expect(result.content).toBe('');
    expect(returned).toBe(true);
  });
});

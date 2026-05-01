import { describe, expect, it, vi, beforeEach } from 'vitest';
import type OpenAI from 'openai';
import { GemmaProvider } from './index';
import type { TUniversalMessage } from '@robota-sdk/agent-core';

vi.mock('openai', () => {
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  }));
  return { default: MockOpenAI };
});

const timestamp = new Date('2026-05-01T00:00:00.000Z');

function createUserMessage(content: string): TUniversalMessage {
  return {
    id: 'user-1',
    role: 'user',
    content,
    state: 'complete',
    timestamp,
  };
}

async function* asyncIterableFrom<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

function createChunk(
  content: string,
  finishReason: OpenAI.Chat.ChatCompletionChunk.Choice['finish_reason'] = null,
): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: 'chunk-1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'supergemma4',
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

describe('GemmaProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an OpenAI-compatible client with local endpoint options', async () => {
    const OpenAIModule = await import('openai');
    const OpenAIConstructor = vi.mocked(OpenAIModule.default);

    const provider = new GemmaProvider({
      apiKey: 'lm-studio',
      baseURL: 'http://localhost:1234/v1',
      timeout: 1000,
    });

    expect(provider.name).toBe('gemma');
    expect(OpenAIConstructor).toHaveBeenCalledWith({
      apiKey: 'lm-studio',
      baseURL: 'http://localhost:1234/v1',
      timeout: 1000,
    });
  });

  it('filters Gemma reasoning markers from non-streaming chat content', async () => {
    const provider = new GemmaProvider({ apiKey: 'lm-studio' });
    const client = (
      provider as unknown as {
        client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
      }
    ).client;
    client.chat.completions.create.mockResolvedValue({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 1,
      model: 'supergemma4',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: '<|channel>thought\nhidden<channel|>Visible answer',
            refusal: null,
          },
          finish_reason: 'stop',
          logprobs: null,
        },
      ],
    });

    const result = await provider.chat([createUserMessage('Hello')], { model: 'supergemma4' });

    expect(result.content).toBe('Visible answer');
    expect(result.metadata?.['gemmaReasoningFiltered']).toBe(true);
    expect(result.metadata?.['gemmaRawContent']).toBe(
      '<|channel>thought\nhidden<channel|>Visible answer',
    );
  });

  it('filters Gemma reasoning markers from streaming chat assembly and deltas', async () => {
    const provider = new GemmaProvider({ apiKey: 'lm-studio' });
    const client = (
      provider as unknown as {
        client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
      }
    ).client;
    client.chat.completions.create.mockResolvedValue(
      asyncIterableFrom([
        createChunk('<|cha'),
        createChunk('nnel>thought\nhidden'),
        createChunk('<channel|>Visible'),
        createChunk(' answer', 'stop'),
      ]),
    );
    const onTextDelta = vi.fn();

    const result = await provider.chat([createUserMessage('Hello')], {
      model: 'supergemma4',
      onTextDelta,
    });

    expect(result.content).toBe('Visible answer');
    expect(onTextDelta).toHaveBeenCalledTimes(2);
    expect(onTextDelta).toHaveBeenNthCalledWith(1, 'Visible');
    expect(onTextDelta).toHaveBeenNthCalledWith(2, ' answer');
    expect(result.metadata?.['gemmaReasoningFiltered']).toBe(true);
  });
});

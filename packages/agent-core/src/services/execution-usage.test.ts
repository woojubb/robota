import { describe, expect, it } from 'vitest';
import type { TUniversalMessage } from '../interfaces/messages';
import { collectAssistantUsageMetadata } from './execution-usage';

describe('collectAssistantUsageMetadata', () => {
  it('normalizes OpenAI-compatible top-level provider usage into input/output metadata', () => {
    const message = {
      id: 'assistant_1',
      role: 'assistant',
      content: 'done',
      state: 'complete',
      timestamp: new Date(),
      usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
    } as TUniversalMessage & {
      usage: { promptTokens: number; completionTokens: number; totalTokens: number };
    };

    expect(collectAssistantUsageMetadata(message)).toEqual({
      inputTokens: 10,
      outputTokens: 4,
      usage: { totalTokens: 14, inputTokens: 10, outputTokens: 4 },
    });
  });

  it('normalizes Gemini-style metadata prompt/completion fields without provider branches', () => {
    const message: TUniversalMessage = {
      id: 'assistant_2',
      role: 'assistant',
      content: 'done',
      state: 'complete',
      timestamp: new Date(),
      metadata: { promptTokens: 20, completionTokens: 5, totalTokens: 25 },
    };

    expect(collectAssistantUsageMetadata(message)).toEqual({
      inputTokens: 20,
      outputTokens: 5,
      usage: { totalTokens: 25, inputTokens: 20, outputTokens: 5 },
    });
  });

  it('normalizes Anthropic-style metadata input/output fields', () => {
    const message: TUniversalMessage = {
      id: 'assistant_3',
      role: 'assistant',
      content: 'done',
      state: 'complete',
      timestamp: new Date(),
      metadata: { inputTokens: 30, outputTokens: 7 },
    };

    expect(collectAssistantUsageMetadata(message)).toEqual({
      inputTokens: 30,
      outputTokens: 7,
      usage: { totalTokens: 37, inputTokens: 30, outputTokens: 7 },
    });
  });

  it('normalizes nested usage objects persisted in metadata', () => {
    const message: TUniversalMessage = {
      id: 'assistant_4',
      role: 'assistant',
      content: 'done',
      state: 'complete',
      timestamp: new Date(),
      metadata: {
        usage: {
          promptTokens: 40,
          completionTokens: 9,
          totalTokens: 49,
        },
      },
    };

    expect(collectAssistantUsageMetadata(message)).toEqual({
      inputTokens: 40,
      outputTokens: 9,
      usage: { totalTokens: 49, inputTokens: 40, outputTokens: 9 },
    });
  });

  it('ignores malformed usage metadata instead of inventing estimates', () => {
    const message: TUniversalMessage = {
      id: 'assistant_5',
      role: 'assistant',
      content: 'done',
      state: 'complete',
      timestamp: new Date(),
      metadata: { usage: 'not-json' },
    };

    expect(collectAssistantUsageMetadata(message)).toBeUndefined();
  });
});

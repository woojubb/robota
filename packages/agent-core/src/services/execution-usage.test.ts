import { describe, expect, it } from 'vitest';
import type { TUniversalMessage } from '../interfaces/messages';
import { readTokenUsageFromMessage } from '../context/token-usage';
import { collectAssistantUsageMetadata, collectCommittedUsageMetadata } from './execution-usage';

function assistantWith(
  usage: Record<string, number>,
  metadata: TUniversalMessage['metadata'] = {},
): TUniversalMessage {
  return {
    id: 'assistant_cache',
    role: 'assistant',
    content: 'done',
    state: 'complete',
    timestamp: new Date(),
    metadata,
    usage,
  } as TUniversalMessage;
}

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

  it('carries the prompt-cache read a provider reported on its message usage', () => {
    const message = assistantWith({
      promptTokens: 1000,
      completionTokens: 20,
      totalTokens: 1020,
      cacheReadTokens: 800,
    });

    expect(readTokenUsageFromMessage(message)).toEqual({
      inputTokens: 1000,
      outputTokens: 20,
      totalTokens: 1020,
      cacheReadTokens: 800,
    });
    expect(collectAssistantUsageMetadata(message)).toEqual({
      inputTokens: 1000,
      outputTokens: 20,
      cacheReadTokens: 800,
      usage: { totalTokens: 1020, inputTokens: 1000, outputTokens: 20, cacheReadTokens: 800 },
    });
  });

  it('keeps a reported zero cache read and adds no key when none, or no valid one, was reported', () => {
    const zero = assistantWith({ promptTokens: 10, completionTokens: 2, cacheReadTokens: 0 });
    expect(collectAssistantUsageMetadata(zero)).toMatchObject({ cacheReadTokens: 0 });

    const beyondInput = assistantWith({
      promptTokens: 10,
      completionTokens: 2,
      cacheReadTokens: 11,
    });
    expect(collectAssistantUsageMetadata(beyondInput)).not.toHaveProperty('cacheReadTokens');

    const none = collectAssistantUsageMetadata(
      assistantWith({ promptTokens: 10, completionTokens: 2 }),
    );
    expect(none).not.toHaveProperty('cacheReadTokens');
    expect(none?.usage).not.toHaveProperty('cacheReadTokens');
  });

  it('reads the cache read back from committed metadata', () => {
    const committed: TUniversalMessage = {
      id: 'assistant_committed',
      role: 'assistant',
      content: 'done',
      state: 'complete',
      timestamp: new Date(),
      metadata: {
        ...collectCommittedUsageMetadata(
          assistantWith({ promptTokens: 50, completionTokens: 5, cacheReadTokens: 30 }),
        ),
      },
    };

    expect(readTokenUsageFromMessage(committed)).toMatchObject({
      inputTokens: 50,
      cacheReadTokens: 30,
    });
  });
});

describe('collectCommittedUsageMetadata', () => {
  it('marks usage the adapter attested as a consistent triple complete', () => {
    const message = assistantWith(
      { promptTokens: 20, completionTokens: 5, totalTokens: 25, cacheReadTokens: 8 },
      { usageProvenance: 'complete' },
    );

    expect(collectCommittedUsageMetadata(message)).toEqual({
      inputTokens: 20,
      outputTokens: 5,
      totalTokens: 25,
      cacheReadTokens: 8,
      usage: { totalTokens: 25, inputTokens: 20, outputTokens: 5, cacheReadTokens: 8 },
      usageProvenance: 'complete',
    });
  });

  it('records usage whose total the provider omitted as their sum, marked partial', () => {
    const message = assistantWith(
      { promptTokens: 100, completionTokens: 10 },
      { usageProvenance: 'partial' },
    );

    expect(collectCommittedUsageMetadata(message)).toMatchObject({
      inputTokens: 100,
      outputTokens: 10,
      totalTokens: 110,
      usageProvenance: 'partial',
    });
  });

  it('records usage whose total disagrees with its parts, marked partial', () => {
    const message = assistantWith(
      { promptTokens: 100, completionTokens: 10, totalTokens: 999 },
      { usageProvenance: 'complete' },
    );

    expect(collectCommittedUsageMetadata(message)).toMatchObject({
      inputTokens: 100,
      outputTokens: 10,
      usageProvenance: 'partial',
    });
  });

  it('records only the provenance when the provider reported no counts', () => {
    expect(
      collectCommittedUsageMetadata({
        id: 'assistant_none',
        role: 'assistant',
        content: 'done',
        state: 'complete',
        timestamp: new Date(),
      }),
    ).toEqual({ usageProvenance: 'absent' });
  });
});

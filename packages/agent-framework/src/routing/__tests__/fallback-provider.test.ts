import {
  AuthenticationError,
  NetworkError,
  ProviderError,
  RateLimitError,
} from '@robota-sdk/agent-core';
import { describe, expect, it } from 'vitest';

import { FallbackProvider } from '../fallback-provider.js';

import type { IFallbackModelTarget } from '../fallback-provider.js';
import type {
  IAIProvider,
  IChatOptions,
  IModelFallbackNotice,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

type TBehavior = (options: IChatOptions) => Promise<TUniversalMessage>;

function reply(content: string): TUniversalMessage {
  return { id: `r-${content}`, role: 'assistant', content, timestamp: new Date(), state: 'complete' };
}

/** A provider whose answers are scripted one call at a time; the last script repeats. */
class ScriptedProvider implements IAIProvider {
  readonly version = '1.0.0';
  readonly calls: Array<{ messages: TUniversalMessage[]; options: IChatOptions }> = [];
  private readonly script: TBehavior[];

  constructor(
    readonly name: string,
    ...script: TBehavior[]
  ) {
    this.script = script.length > 0 ? script : [async () => reply(name)];
  }

  async chat(messages: TUniversalMessage[], options: IChatOptions = {}): Promise<TUniversalMessage> {
    this.calls.push({ messages, options });
    const behavior = this.script[Math.min(this.calls.length - 1, this.script.length - 1)]!;
    return behavior(options);
  }

  generateResponse(): never {
    throw new Error('not used');
  }

  supportsTools(): boolean {
    return true;
  }

  validateConfig(): boolean {
    return true;
  }
}

const fail = (error: unknown): TBehavior => async () => {
  throw error;
};
const answer = (content: string): TBehavior => async () => reply(content);

const overloaded = (): ProviderError =>
  new ProviderError('overloaded', 'anthropic', undefined, undefined, {
    status: 529,
    type: 'overloaded_error',
  });
const unavailable = (): ProviderError =>
  new ProviderError('service unavailable', 'anthropic', undefined, undefined, { status: 503 });

const MESSAGES: TUniversalMessage[] = [
  { id: 'u1', role: 'user', content: 'hello', timestamp: new Date(), state: 'complete' },
];

function target(provider: IAIProvider, model: string): IFallbackModelTarget {
  return { ref: { provider: provider.name, model }, create: () => provider };
}

describe('FallbackProvider', () => {
  it.each([
    ['an overload (529)', overloaded],
    ['a 503', unavailable],
  ])('moves to the next entry on %s and says so', async (_label, error) => {
    const primary = new ScriptedProvider('anthropic', fail(error()));
    const next = new ScriptedProvider('openai', answer('from next'));
    const provider = new FallbackProvider(primary, [target(next, 'gpt-next')]);
    const notices: IModelFallbackNotice[] = [];

    const response = await provider.chat(MESSAGES, {
      model: 'claude-primary',
      onModelFallback: (notice) => notices.push(notice),
    });

    expect(response.content).toBe('from next');
    expect(next.calls[0]?.options.model).toBe('gpt-next');
    expect(notices).toEqual([
      {
        from: { provider: 'anthropic', model: 'claude-primary' },
        to: { provider: 'openai', model: 'gpt-next' },
        reason: expect.stringMatching(/overloaded|service-unavailable/),
      },
    ]);
  });

  it.each([
    ['authentication (401)', () => new ProviderError('bad key', 'x', undefined, undefined, { status: 401 })],
    ['an AuthenticationError', () => new AuthenticationError('bad key', 'x')],
    ['a rate limit (429)', () => new RateLimitError('slow down', undefined, 'x')],
    ['a network failure', () => new NetworkError('socket closed')],
    ['a bad request (400)', () => new ProviderError('bad', 'x', undefined, undefined, { status: 400 })],
    ['a payload too large (413)', () => new ProviderError('big', 'x', undefined, undefined, { status: 413 })],
    ['billing (402)', () => new ProviderError('pay', 'x', undefined, undefined, { status: 402 })],
  ])('does not move on %s', async (_label, error) => {
    const thrown = error();
    const primary = new ScriptedProvider('anthropic', fail(thrown));
    const next = new ScriptedProvider('openai');
    const provider = new FallbackProvider(primary, [target(next, 'gpt-next')]);

    await expect(provider.chat(MESSAGES, { model: 'claude-primary' })).rejects.toBe(thrown);
    expect(next.calls).toHaveLength(0);
  });

  it('does not move when the caller aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const thrown = overloaded();
    const primary = new ScriptedProvider('anthropic', fail(thrown));
    const next = new ScriptedProvider('openai');
    const provider = new FallbackProvider(primary, [target(next, 'gpt-next')]);

    await expect(
      provider.chat(MESSAGES, { model: 'claude-primary', signal: controller.signal }),
    ).rejects.toBe(thrown);
    expect(next.calls).toHaveLength(0);
  });

  it('does not move once output has streamed, because it cannot be taken back', async () => {
    const thrown = overloaded();
    const primary = new ScriptedProvider('anthropic', async (options) => {
      options.onTextDelta?.('partial answer');
      throw thrown;
    });
    const next = new ScriptedProvider('openai');
    const provider = new FallbackProvider(primary, [target(next, 'gpt-next')]);
    const deltas: string[] = [];

    await expect(
      provider.chat(MESSAGES, { model: 'claude-primary', onTextDelta: (d) => deltas.push(d) }),
    ).rejects.toBe(thrown);
    expect(deltas).toEqual(['partial answer']);
    expect(next.calls).toHaveLength(0);
  });

  it('falls through an entry that cannot be built to the next one', async () => {
    const primary = new ScriptedProvider('anthropic', fail(overloaded()));
    const last = new ScriptedProvider('gemini', answer('from last'));
    const unreachable: string[] = [];
    const provider = new FallbackProvider(
      primary,
      [
        {
          ref: { provider: 'openai', model: 'gpt-missing-key' },
          create: () => {
            throw new Error('OPENAI_API_KEY is not set');
          },
        },
        target(last, 'gemini-last'),
      ],
      { onUnreachable: (entry) => unreachable.push(entry.ref.model) },
    );
    const notices: IModelFallbackNotice[] = [];

    const response = await provider.chat(MESSAGES, {
      model: 'claude-primary',
      onModelFallback: (notice) => notices.push(notice),
    });

    expect(response.content).toBe('from last');
    expect(unreachable).toEqual(['gpt-missing-key']);
    expect(notices.map((notice) => notice.to.model)).toEqual(['gemini-last']);
    expect(notices[0]?.from.model).toBe('claude-primary');
  });

  it('rethrows the last real failure when every entry is exhausted', async () => {
    const thrown = overloaded();
    const primary = new ScriptedProvider('anthropic', fail(thrown));
    const provider = new FallbackProvider(primary, [
      {
        ref: { provider: 'openai', model: 'gpt-missing-key' },
        create: () => {
          throw new Error('no key');
        },
      },
    ]);

    await expect(provider.chat(MESSAGES, { model: 'claude-primary' })).rejects.toBe(thrown);
  });

  it('keeps the rest of a run on the model that accepted it, and starts the next run on the primary', async () => {
    const primary = new ScriptedProvider('anthropic', fail(overloaded()), answer('primary again'));
    const next = new ScriptedProvider('openai', answer('next'));
    const provider = new FallbackProvider(primary, [target(next, 'gpt-next')]);

    await provider.chat(MESSAGES, { model: 'claude-primary', executionId: 'run-1' });
    expect(provider.resolveModelRoute('claude-primary', 'run-1')).toEqual({
      provider: 'openai',
      model: 'gpt-next',
    });
    const secondRound = await provider.chat(MESSAGES, {
      model: 'claude-primary',
      executionId: 'run-1',
    });
    expect(secondRound.content).toBe('next');
    expect(primary.calls).toHaveLength(1);

    expect(provider.resolveModelRoute('claude-primary', 'run-2')).toEqual({
      provider: 'anthropic',
      model: 'claude-primary',
    });
    const nextRun = await provider.chat(MESSAGES, { model: 'claude-primary', executionId: 'run-2' });
    expect(nextRun.content).toBe('primary again');
    expect(primary.calls).toHaveLength(2);
  });

  it('hands the next model the same messages, without the primary vendor’s own options', async () => {
    const primary = new ScriptedProvider('anthropic', fail(overloaded()));
    const next = new ScriptedProvider('openai');
    const provider = new FallbackProvider(primary, [target(next, 'gpt-next')]);
    const tools = [{ name: 'Read', description: 'read', parameters: { type: 'object' as const, properties: {} } }];

    await provider.chat(MESSAGES, {
      model: 'claude-primary',
      tools,
      temperature: 0.2,
      nativeWebTools: { webSearch: true },
      anthropic: { topK: 3 },
      preserveContextWindow: false,
      onModelFallback: () => undefined,
    });

    const sent = next.calls[0]!;
    expect(sent.messages).toBe(primary.calls[0]!.messages);
    expect(sent.options.tools).toEqual(tools);
    expect(sent.options.temperature).toBe(0.2);
    expect(sent.options).not.toHaveProperty('nativeWebTools');
    expect(sent.options).not.toHaveProperty('anthropic');
    expect(sent.options).not.toHaveProperty('onModelFallback');
    expect(primary.calls[0]!.options.nativeWebTools).toEqual({ webSearch: true });
  });

  describe('when the request must keep its context window (compaction)', () => {
    const windows: Record<string, number> = {
      'claude-primary': 200_000,
      'small-model': 32_000,
      'large-model': 1_000_000,
    };
    const contextWindowOf = (model: string): number | undefined => windows[model];

    it('skips a smaller window and a model whose window is unknown', async () => {
      const primary = new ScriptedProvider('anthropic', fail(overloaded()));
      const small = new ScriptedProvider('openai');
      const unknown = new ScriptedProvider('gemini');
      const large = new ScriptedProvider('openai-large', answer('large'));
      const provider = new FallbackProvider(
        primary,
        [target(small, 'small-model'), target(unknown, 'mystery-model'), target(large, 'large-model')],
        { contextWindowOf },
      );

      const response = await provider.chat(MESSAGES, {
        model: 'claude-primary',
        preserveContextWindow: true,
      });

      expect(response.content).toBe('large');
      expect(small.calls).toHaveLength(0);
      expect(unknown.calls).toHaveLength(0);
    });

    it('a normal turn may still use a smaller window', async () => {
      const primary = new ScriptedProvider('anthropic', fail(overloaded()));
      const small = new ScriptedProvider('openai', answer('small'));
      const provider = new FallbackProvider(primary, [target(small, 'small-model')], {
        contextWindowOf,
      });

      const response = await provider.chat(MESSAGES, { model: 'claude-primary' });
      expect(response.content).toBe('small');
    });
  });
});

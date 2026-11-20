import { afterEach, describe, expect, it } from 'vitest';
import { ConversationAgent } from '../../core/conversation-agent';
import { createScriptedProvider } from '../../testing/scripted-provider';
import { CacheKeyBuilder } from '../cache/cache-key-builder';
import { ExecutionCacheService } from '../cache/execution-cache-service';
import { MemoryCacheStorage } from '../cache/memory-cache-storage';
import { callProviderWithCache } from '../execution-round-provider';
import type { IAgentConfig } from '../../interfaces/agent';
import type { IResolvedProviderInfo } from '../execution-types';
import type { TUniversalMessage } from '../../interfaces/messages';

const agents: ConversationAgent[] = [];
afterEach(async () => {
  await Promise.all(agents.splice(0).map((agent) => agent.destroy()));
});

function fixture() {
  const scripted = createScriptedProvider([{ text: 'first answer' }, { text: 'second answer' }]);
  scripted.provider.textResponseCacheScope = () => 'scripted-test-provider';
  const config: IAgentConfig = {
    name: 'cache-identity',
    aiProviders: [scripted.provider],
    defaultModel: { provider: scripted.provider.name, model: 'test-model' },
    cache: { enabled: true, maxEntries: 10, ttlMs: 60_000 },
  };
  const agent = new ConversationAgent(config);
  agents.push(agent);
  return { agent, config, ...scripted };
}

function callFixture() {
  const { provider, config, requests } = fixture();
  const resolved: IResolvedProviderInfo = {
    provider,
    currentInfo: { provider: provider.name },
    aiProviderInfo: {
      providerName: provider.name,
      model: 'test-model',
      temperature: undefined,
      maxTokens: undefined,
    },
    toolsInfo: [],
    readAvailableTools: () => [],
    deferredTools: { listDeferredTools: () => [], loadDeferredTools: () => [] },
  };
  const cache = new ExecutionCacheService(
    new MemoryCacheStorage({ maxEntries: 10, ttlMs: 60_000 }),
    new CacheKeyBuilder(),
  );
  const messages: TUniversalMessage[] = [
    { id: 'input', role: 'user', content: 'same input', state: 'complete', timestamp: new Date(0) },
  ];
  return { provider, config, requests, resolved, cache, messages };
}

describe('response cache request identity', () => {
  it.each([
    { first: { temperature: 0.1 }, second: { temperature: 0.9 }, name: 'temperature' },
    { first: { maxTokens: 100 }, second: { maxTokens: 200 }, name: 'output limit' },
  ])('does not reuse an answer across different $name overrides', async ({ first, second }) => {
    const { agent, requests } = fixture();
    await agent.ensureReady();
    agent.clearHistory();
    await expect(agent.run('same input', first)).resolves.toBe('first answer');
    agent.clearHistory();
    await expect(agent.run('same input', second)).resolves.toBe('second answer');
    expect(requests).toHaveLength(2);
  });

  it.each([
    { first: Number.NaN, second: Number.POSITIVE_INFINITY, name: 'non-finite values' },
    { first: -0, second: 0, name: 'negative and positive zero' },
  ])('does not collapse $name in request options', async ({ first, second }) => {
    const { agent, requests } = fixture();
    await agent.ensureReady();
    agent.clearHistory();
    await expect(agent.run('same input', { temperature: first })).resolves.toBe('first answer');
    agent.clearHistory();
    await expect(agent.run('same input', { temperature: second })).resolves.toBe('second answer');
    expect(requests).toHaveLength(2);
  });

  it('does not equate a Date in message metadata with its ISO string', async () => {
    const { agent, requests } = fixture();
    await agent.ensureReady();
    const timestamp = '2026-01-02T03:04:05.000Z';
    const useMetadata = (sentAt: Date | string): void => {
      agent.clearHistory();
      agent.injectRawMessage({
        id: 'metadata',
        role: 'user',
        content: 'same input',
        state: 'complete',
        timestamp: new Date(0),
        metadata: { sentAt },
      });
    };
    useMetadata(new Date(timestamp));
    await expect(agent.run('continue')).resolves.toBe('first answer');
    useMetadata(timestamp);
    await expect(agent.run('continue')).resolves.toBe('second answer');
    expect(requests).toHaveLength(2);
  });

  it('distinguishes absent metadata from an explicitly undefined property', async () => {
    const { agent, requests } = fixture();
    await agent.ensureReady();
    const useMessage = (explicitUndefined: boolean): void => {
      agent.clearHistory();
      agent.injectRawMessage({
        id: 'input',
        role: 'user',
        content: 'same input',
        state: 'complete',
        timestamp: new Date(0),
        ...(explicitUndefined && { metadata: undefined }),
      });
    };
    useMessage(false);
    await expect(agent.run('continue')).resolves.toBe('first answer');
    useMessage(false);
    await expect(agent.run('continue')).resolves.toBe('first answer');
    useMessage(true);
    await expect(agent.run('continue')).resolves.toBe('second answer');
    expect(requests).toHaveLength(2);
  });

  it('does not collapse null-prototype metadata values into ordinary objects', async () => {
    const { agent, requests } = fixture();
    await agent.ensureReady();
    const useMetadata = (counts: Record<string, number>): void => {
      agent.clearHistory();
      agent.injectRawMessage({
        id: 'input',
        role: 'user',
        content: 'same input',
        state: 'complete',
        timestamp: new Date(0),
        metadata: { counts },
      });
    };
    useMetadata(Object.assign(Object.create(null), { count: 1 }));
    await expect(agent.run('continue')).resolves.toBe('first answer');
    useMetadata({ count: 1 });
    await expect(agent.run('continue')).resolves.toBe('second answer');
    useMetadata({ count: 1 });
    await expect(agent.run('continue')).resolves.toBe('second answer');
    expect(requests).toHaveLength(2);
  });

  it('does not cache when the provider has not opted the request in', async () => {
    const { provider, config, requests, resolved, cache, messages } = callFixture();
    expect((await callProviderWithCache(messages, config, resolved, cache)).content).toBe(
      'first answer',
    );
    delete provider.textResponseCacheScope;
    expect((await callProviderWithCache(messages, config, resolved, cache)).content).toBe(
      'second answer',
    );
    provider.textResponseCacheScope = () => 'scripted-test-provider';
    expect((await callProviderWithCache(messages, config, resolved, cache)).content).toBe(
      'first answer',
    );
    expect(requests).toHaveLength(2);
  });

  it('does not treat the stateful scripted provider as cache safe by default', async () => {
    const scripted = createScriptedProvider([{ text: 'first' }, { text: 'second' }]);
    const agent = new ConversationAgent({
      name: 'stateful-script',
      aiProviders: [scripted.provider],
      defaultModel: { provider: scripted.provider.name, model: 'test-model' },
      cache: { enabled: true, maxEntries: 10, ttlMs: 60_000 },
    });
    agents.push(agent);
    await agent.ensureReady();
    agent.clearHistory();
    await expect(agent.run('same input')).resolves.toBe('first');
    agent.clearHistory();
    await expect(agent.run('same input')).resolves.toBe('second');
    expect(scripted.requests).toHaveLength(2);
  });

  it('does not share entries across provider instances with the same name and model', async () => {
    const { agent } = fixture();
    await agent.ensureReady();
    agent.clearHistory();
    await expect(agent.run('same input')).resolves.toBe('first answer');
    const replacement = createScriptedProvider([{ text: 'replacement answer' }]);
    replacement.provider.textResponseCacheScope = () => 'scripted-test-provider';
    agent.swapDefaultProvider(replacement.provider, 'test-model');
    agent.clearHistory();
    await expect(agent.run('same input')).resolves.toBe('replacement answer');
    expect(replacement.requests).toHaveLength(1);
  });

  it('separates cache entries when the provider changes its cache scope', async () => {
    const { provider, config, requests, resolved, cache, messages } = callFixture();
    let scope = 'first configuration';
    provider.textResponseCacheScope = () => scope;
    expect((await callProviderWithCache(messages, config, resolved, cache)).content).toBe(
      'first answer',
    );
    scope = 'second configuration';
    expect((await callProviderWithCache(messages, config, resolved, cache)).content).toBe(
      'second answer',
    );
    expect(requests).toHaveLength(2);
  });

  it('does not store an answer when the provider configuration revision changes in flight', async () => {
    const { provider, config, requests, resolved, cache, messages } = callFixture();
    let revision = 1;
    let configuration = 'A';
    let enter!: () => void;
    let observe!: () => void;
    let observed!: () => void;
    let finish!: () => void;
    const entered = new Promise<void>((resolve) => (enter = resolve));
    const mayObserve = new Promise<void>((resolve) => (observe = resolve));
    const didObserve = new Promise<void>((resolve) => (observed = resolve));
    const mayFinish = new Promise<void>((resolve) => (finish = resolve));
    provider.textResponseCacheScope = () => `configuration-revision-${revision}`;
    const chat = provider.chat.bind(provider);
    let firstCall = true;
    provider.chat = async (input, options) => {
      let answer = configuration;
      if (firstCall) {
        firstCall = false;
        enter();
        await mayObserve;
        answer = configuration;
        observed();
        await mayFinish;
      }
      const response = await chat(input, options);
      response.content = answer;
      return response;
    };
    const first = callProviderWithCache(messages, config, resolved, cache);
    await entered;
    configuration = 'B';
    revision++;
    observe();
    await didObserve;
    configuration = 'A';
    revision++;
    finish();
    expect((await first).content).toBe('B');
    expect(cache.getStats().entries).toBe(0);
    expect((await callProviderWithCache(messages, config, resolved, cache)).content).toBe('A');
    expect(requests).toHaveLength(2);
  });

  it('does not reuse an answer for different images with the same message text', async () => {
    const { agent, requests } = fixture();
    await agent.ensureReady();
    const useImage = (uri: string): void => {
      agent.clearHistory();
      agent.injectRawMessage({
        id: 'image',
        role: 'user',
        content: 'Describe this image',
        parts: [{ type: 'image_uri', uri }],
        state: 'complete',
        timestamp: new Date(0),
      });
    };
    useImage('https://example.test/first.png');
    await expect(agent.run('continue')).resolves.toBe('first answer');
    useImage('https://example.test/second.png');
    await expect(agent.run('continue')).resolves.toBe('second answer');
    expect(requests).toHaveLength(2);
  });

  it('does not cache an image URI whose contents may change', async () => {
    const { agent, requests } = fixture();
    await agent.ensureReady();
    const useImage = (): void => {
      agent.clearHistory();
      agent.injectRawMessage({
        id: 'image',
        role: 'user',
        content: 'Describe this image',
        parts: [{ type: 'image_uri', uri: 'https://example.test/current.png' }],
        state: 'complete',
        timestamp: new Date(0),
      });
    };
    useImage();
    await expect(agent.run('continue')).resolves.toBe('first answer');
    useImage();
    await expect(agent.run('continue')).resolves.toBe('second answer');
    expect(requests).toHaveLength(2);
  });

  it('does not reuse an answer across different provider continuations', async () => {
    const { agent, requests } = fixture();
    await agent.ensureReady();
    const useContinuation = (continuation: string): void => {
      agent.clearHistory();
      agent.injectRawMessage({
        id: 'assistant',
        role: 'assistant',
        content: 'same answer',
        metadata: { providerContinuation: continuation },
        state: 'complete',
        timestamp: new Date(0),
      });
    };
    useContinuation('first-context');
    await expect(agent.run('continue')).resolves.toBe('first answer');
    useContinuation('second-context');
    await expect(agent.run('continue')).resolves.toBe('second answer');
    expect(requests).toHaveLength(2);
  });

  it('does not cache a turn carrying an opaque provider continuation', async () => {
    const { agent, requests } = fixture();
    await agent.ensureReady();
    const restore = (): void => {
      agent.clearHistory();
      agent.injectRawMessage({
        id: 'assistant',
        role: 'assistant',
        content: 'same answer',
        metadata: { providerContinuation: 'cursor' },
        state: 'complete',
        timestamp: new Date(0),
      });
    };
    restore();
    await expect(agent.run('continue')).resolves.toBe('first answer');
    restore();
    await expect(agent.run('continue')).resolves.toBe('second answer');
    expect(requests).toHaveLength(2);
  });

  it('does not cache a response that carries a provider continuation', async () => {
    const { provider, config, requests, resolved, cache, messages } = callFixture();
    const chat = provider.chat.bind(provider);
    provider.chat = async (input, options) => {
      const response = await chat(input, options);
      if (response.role === 'assistant') response.metadata = { providerContinuation: 'cursor' };
      return response;
    };
    expect((await callProviderWithCache(messages, config, resolved, cache)).content).toBe(
      'first answer',
    );
    expect((await callProviderWithCache(messages, config, resolved, cache)).content).toBe(
      'second answer',
    );
    expect(requests).toHaveLength(2);
  });

  it('does not cache a response with a non-enumerable continuation', async () => {
    const { provider, config, requests, resolved, cache, messages } = callFixture();
    const chat = provider.chat.bind(provider);
    provider.chat = async (input, options) => {
      const response = await chat(input, options);
      response.metadata = {};
      Object.defineProperty(response.metadata, 'providerContinuation', { value: 'cursor' });
      return response;
    };
    const first = await callProviderWithCache(messages, config, resolved, cache);
    const second = await callProviderWithCache(messages, config, resolved, cache);
    expect(first.metadata?.providerContinuation).toBe('cursor');
    expect(second.metadata?.providerContinuation).toBe('cursor');
    expect(requests).toHaveLength(2);
  });

  it('does not cache a response with extra non-text state', async () => {
    const { provider, config, requests, resolved, cache, messages } = callFixture();
    const chat = provider.chat.bind(provider);
    provider.chat = async (input, options) => {
      const response = await chat(input, options);
      if (response.role === 'assistant') response.toolCalls = [];
      return response;
    };
    await callProviderWithCache(messages, config, resolved, cache);
    await callProviderWithCache(messages, config, resolved, cache);
    expect(requests).toHaveLength(2);
  });

  it('does not cache a response that has message parts', async () => {
    const { provider, config, requests, resolved, cache, messages } = callFixture();
    const chat = provider.chat.bind(provider);
    provider.chat = async (input, options) => {
      const response = await chat(input, options);
      if (response.role === 'assistant') response.parts = [{ type: 'text', text: 'extra content' }];
      return response;
    };
    expect((await callProviderWithCache(messages, config, resolved, cache)).content).toBe(
      'first answer',
    );
    expect((await callProviderWithCache(messages, config, resolved, cache)).content).toBe(
      'second answer',
    );
    expect(requests).toHaveLength(2);
  });

  it('does not cache a response with non-usage metadata', async () => {
    const { provider, config, requests, resolved, cache, messages } = callFixture();
    const chat = provider.chat.bind(provider);
    provider.chat = async (input, options) => {
      const response = await chat(input, options);
      if (response.role === 'assistant') response.metadata = { stopReason: 'complete' };
      return response;
    };
    expect((await callProviderWithCache(messages, config, resolved, cache)).content).toBe(
      'first answer',
    );
    expect((await callProviderWithCache(messages, config, resolved, cache)).content).toBe(
      'second answer',
    );
    expect(requests).toHaveLength(2);
  });

  it('does not attribute a previous model call usage to a cached response', async () => {
    const { provider, config, requests, resolved, cache, messages } = callFixture();
    const chat = provider.chat.bind(provider);
    provider.chat = async (input, options) => {
      const response = await chat(input, options);
      if (response.role === 'assistant') {
        response.metadata = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
      }
      return response;
    };
    const first = await callProviderWithCache(messages, config, resolved, cache);
    const cached = await callProviderWithCache(messages, config, resolved, cache);
    expect(first.metadata).toMatchObject({ inputTokens: 10, outputTokens: 5 });
    expect(cached.content).toBe('first answer');
    expect(cached.metadata).toBeUndefined();
    expect(requests).toHaveLength(1);
  });

  it('does not cache calls that may use an enabled provider-hosted tool', async () => {
    const { provider, config, requests, resolved, cache, messages } = callFixture();
    provider.getCapabilities = () => ({
      functionCalling: { supported: true },
      nativeWebTools: {
        webSearch: { supported: true, enabled: true },
        webFetch: { supported: false, enabled: false },
      },
    });
    expect((await callProviderWithCache(messages, config, resolved, cache)).content).toBe(
      'first answer',
    );
    expect((await callProviderWithCache(messages, config, resolved, cache)).content).toBe(
      'second answer',
    );
    expect(requests).toHaveLength(2);
  });

  it('can cache a provider-hosted-tool route when the tool is explicitly withheld', async () => {
    const { provider, config, requests, resolved, cache, messages } = callFixture();
    provider.getCapabilities = () => ({
      functionCalling: { supported: true },
      nativeWebTools: {
        webSearch: { supported: true, enabled: true },
        webFetch: { supported: false, enabled: false },
      },
    });
    const run = () =>
      callProviderWithCache(messages, config, resolved, cache, {
        nativeWebTools: { webSearch: false },
      });
    expect((await run()).content).toBe('first answer');
    expect((await run()).content).toBe('first answer');
    expect(requests).toHaveLength(1);
  });

  it('does not cache when a provider-hosted tool is requested but not declared', async () => {
    const { config, requests, resolved, cache, messages } = callFixture();
    const run = () =>
      callProviderWithCache(messages, config, resolved, cache, {
        nativeWebTools: { webSearch: true },
      });
    expect((await run()).content).toBe('first answer');
    expect((await run()).content).toBe('second answer');
    expect(requests).toHaveLength(2);
  });

  it('does not cache when provider-hosted-tool capability cannot be read', async () => {
    const { provider, config, requests, resolved, cache, messages } = callFixture();
    provider.getCapabilities = () => {
      throw new Error('capability unavailable');
    };
    expect((await callProviderWithCache(messages, config, resolved, cache)).content).toBe(
      'first answer',
    );
    expect((await callProviderWithCache(messages, config, resolved, cache)).content).toBe(
      'second answer',
    );
    expect(requests).toHaveLength(2);
  });

  it('does not reuse a plain-text answer for a JSON response request', async () => {
    const { config, requests, resolved, cache, messages } = callFixture();
    expect(
      (
        await callProviderWithCache(messages, config, resolved, cache, {
          responseFormat: { type: 'text' },
        })
      ).content,
    ).toBe('first answer');
    expect(
      (
        await callProviderWithCache(messages, config, resolved, cache, {
          responseFormat: { type: 'json_object' },
        })
      ).content,
    ).toBe('second answer');
    expect(requests).toHaveLength(2);
  });

  it('distinguishes an explicitly empty tool list from an omitted list', async () => {
    const { config, requests, resolved, cache, messages } = callFixture();
    expect((await callProviderWithCache(messages, config, resolved, cache)).content).toBe(
      'first answer',
    );
    expect(
      (await callProviderWithCache(messages, config, resolved, cache, { tools: [] })).content,
    ).toBe('second answer');
    expect(requests).toHaveLength(2);
  });

  it('does not collapse non-finite numbers in provider-specific options', async () => {
    const { config, requests, resolved, cache, messages } = callFixture();
    const run = (topP: number) =>
      callProviderWithCache(messages, config, resolved, cache, { openai: { topP } });
    expect((await run(Number.NaN)).content).toBe('first answer');
    expect((await run(Number.POSITIVE_INFINITY)).content).toBe('second answer');
    expect(requests).toHaveLength(2);
  });

  it('uses the original request identity if the provider mutates an option', async () => {
    const { provider, config, requests, resolved, cache, messages } = callFixture();
    const chat = provider.chat.bind(provider);
    provider.chat = async (input, options) => {
      const response = await chat(input, options);
      if (options?.openai) options.openai.topP = 0.9;
      return response;
    };
    const run = () =>
      callProviderWithCache(messages, config, resolved, cache, { openai: { topP: 0.1 } });
    expect((await run()).content).toBe('first answer');
    expect((await run()).content).toBe('first answer');
    expect(requests).toHaveLength(1);
  });

  it('sends a detached snapshot if caller-owned messages or options change in flight', async () => {
    const { provider, config, requests, resolved, cache, messages } = callFixture();
    let release!: () => void;
    let markEntered!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const entered = new Promise<void>((resolve) => (markEntered = resolve));
    const chat = provider.chat.bind(provider);
    provider.chat = async (input, options) => {
      markEntered();
      await gate;
      const response = await chat(input, options);
      response.content = `${input[0].metadata?.marker}:${options?.openai?.topP}`;
      return response;
    };
    const metadata = { marker: 'A' };
    messages[0].metadata = metadata;
    const openai = { topP: 0.1 };
    const first = callProviderWithCache(messages, config, resolved, cache, { openai });
    await entered;
    metadata.marker = 'B';
    openai.topP = 0.9;
    release();
    expect((await first).content).toBe('A:0.1');
    const original = structuredClone(messages);
    original[0].metadata = { marker: 'A' };
    expect(
      (await callProviderWithCache(original, config, resolved, cache, { openai: { topP: 0.1 } }))
        .content,
    ).toBe('A:0.1');
    expect(requests).toHaveLength(1);
  });

  it('uses the original message identity if the provider mutates its input', async () => {
    const { provider, config, requests, resolved, cache, messages } = callFixture();
    const nextMessages = structuredClone(messages);
    const chat = provider.chat.bind(provider);
    provider.chat = async (input, options) => {
      const response = await chat(input, options);
      input[0].content = 'changed by adapter';
      return response;
    };
    expect((await callProviderWithCache(messages, config, resolved, cache)).content).toBe(
      'first answer',
    );
    expect((await callProviderWithCache(nextMessages, config, resolved, cache)).content).toBe(
      'first answer',
    );
    expect(requests).toHaveLength(1);
  });
});

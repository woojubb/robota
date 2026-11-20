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

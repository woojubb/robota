import { describe, expect, it, vi } from 'vitest';
import { CacheKeyBuilder } from '../cache/cache-key-builder';
import { ExecutionCacheService } from '../cache/execution-cache-service';
import { MemoryCacheStorage } from '../cache/memory-cache-storage';
import { callProviderWithCache } from '../execution-round-provider';
import type { IAgentConfig } from '../../interfaces/agent';
import type { TUniversalMessage } from '../../interfaces/messages';
import type { IModelRoute } from '../execution-model-route';
import type { IResolvedProviderInfo } from '../execution-types';

const messages: TUniversalMessage[] = [
  { id: 'u1', role: 'user', content: 'hi', state: 'complete', timestamp: new Date() },
];
const config: IAgentConfig = {
  name: 'test',
  aiProviders: [],
  defaultModel: { provider: 'primary', model: 'primary-model' },
};

function reply(content: string): TUniversalMessage {
  return { id: content, role: 'assistant', content, state: 'complete', timestamp: new Date() };
}

function fixture(chat: IResolvedProviderInfo['provider']['chat']) {
  const provider: IResolvedProviderInfo['provider'] = {
    chat,
    textResponseCacheScope: () => 'primary',
  };
  const resolved: IResolvedProviderInfo = {
    provider,
    currentInfo: { provider: 'primary' },
    aiProviderInfo: {
      providerName: 'primary',
      model: 'primary-model',
      temperature: undefined,
      maxTokens: undefined,
    },
    toolsInfo: [],
    readAvailableTools: () => [],
    deferredTools: { listDeferredTools: () => [], loadDeferredTools: () => [] },
  };
  const cache = new ExecutionCacheService(
    new MemoryCacheStorage({ maxEntries: 100, ttlMs: 60_000 }),
    new CacheKeyBuilder(),
  );
  const call = (route: IModelRoute) =>
    callProviderWithCache(
      messages,
      config,
      resolved,
      cache,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      route,
    );
  return { provider, call };
}

describe('response cache with model routing', () => {
  it('does not store an answer after the route moves during the provider call', async () => {
    const route: IModelRoute = {};
    const chat = vi.fn(async () => {
      route.current = { provider: 'fallback', model: 'fallback-model' };
      return reply('fallback answer');
    });
    const { call } = fixture(chat);
    await call(route);
    route.current = undefined;
    await call(route);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('does not look up an entry when a different route is already selected', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(reply('primary'))
      .mockResolvedValueOnce(reply('fallback'));
    const { call } = fixture(chat);
    expect((await call({})).content).toBe('primary');
    expect(
      (await call({ current: { provider: 'fallback', model: 'fallback-model' } })).content,
    ).toBe('fallback');
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('does not cache through a routing wrapper even before its route changes', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(reply('first'))
      .mockResolvedValueOnce(reply('second'));
    const { call, provider } = fixture(chat);
    provider.resolveModelRoute = () => ({ provider: 'primary', model: 'primary-model' });
    expect((await call({})).content).toBe('first');
    expect((await call({})).content).toBe('second');
    expect(chat).toHaveBeenCalledTimes(2);
  });
});

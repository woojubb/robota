/**
 * The response cache is keyed on the model a request actually goes to, so an answer from a
 * substitute model is never served as the requested model's, nor the other way round.
 */

import { describe, expect, it, vi } from 'vitest';

import { CacheKeyBuilder } from '../cache/cache-key-builder';
import { ExecutionCacheService } from '../cache/execution-cache-service';
import { MemoryCacheStorage } from '../cache/memory-cache-storage';
import { callProviderWithCache } from '../execution-round-provider';

import type { TUniversalMessage } from '../../interfaces/messages';
import type { IModelRoute } from '../execution-model-route';

const MESSAGES: TUniversalMessage[] = [
  { id: 'u1', role: 'user', content: 'hi', state: 'complete', timestamp: new Date() },
];
const CONFIG = { name: 'test', defaultModel: { provider: 'anthropic', model: 'claude-primary' } };

function reply(content: string): TUniversalMessage {
  return {
    id: `a-${content}`,
    role: 'assistant',
    content,
    state: 'complete',
    timestamp: new Date(),
  };
}

function resolvedWith(chat: (...args: unknown[]) => Promise<TUniversalMessage>): never {
  return {
    provider: { chat },
    currentInfo: { provider: 'anthropic' },
    aiProviderInfo: { providerName: 'anthropic', model: 'claude-primary' },
    toolsInfo: [],
    readAvailableTools: () => [],
    deferredTools: { listDeferredTools: () => [], loadDeferredTools: () => [] },
  } as never;
}

function newCache(): ExecutionCacheService {
  return new ExecutionCacheService(
    new MemoryCacheStorage({ maxEntries: 100, ttlMs: 60_000 }),
    new CacheKeyBuilder(),
  );
}

async function call(
  cache: ExecutionCacheService,
  route: IModelRoute,
  chat: (...args: unknown[]) => Promise<TUniversalMessage>,
): Promise<TUniversalMessage> {
  return callProviderWithCache(
    MESSAGES,
    CONFIG as never,
    resolvedWith(chat),
    cache,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    route,
  );
}

describe('cache keyed on the model route', () => {
  it('stores a substitute model’s answer under that model, not the requested one', async () => {
    const cache = newCache();
    const moved: IModelRoute = {};
    await call(cache, moved, async () => {
      // The provider moved the request while answering it.
      moved.current = { provider: 'openai', model: 'gpt-next' };
      return reply('from fallback');
    });

    const primaryChat = vi.fn(async () => reply('from primary'));
    const onPrimary = await call(cache, {}, primaryChat);
    expect(onPrimary.content).toBe('from primary');
    expect(primaryChat).toHaveBeenCalledOnce();

    const fallbackChat = vi.fn(async () => reply('fresh'));
    const onFallback = await call(
      cache,
      { current: { provider: 'openai', model: 'gpt-next' } },
      fallbackChat,
    );
    expect(onFallback.content).toBe('from fallback');
    expect(fallbackChat).not.toHaveBeenCalled();
  });

  it('does not serve the requested model’s answer to a run that is on a substitute', async () => {
    const cache = newCache();
    await call(cache, {}, async () => reply('from primary'));

    const fallbackChat = vi.fn(async () => reply('from fallback'));
    const response = await call(
      cache,
      { current: { provider: 'openai', model: 'gpt-next' } },
      fallbackChat,
    );
    expect(response.content).toBe('from fallback');
    expect(fallbackChat).toHaveBeenCalledOnce();
  });
});

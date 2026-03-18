import type { TUniversalMessage } from '../../interfaces/messages';
import type { ICacheStorage, ICacheStats } from '../../interfaces/cache';
import { CacheKeyBuilder } from './cache-key-builder';

export class ExecutionCacheService {
  constructor(
    private readonly storage: ICacheStorage,
    private readonly keyBuilder: CacheKeyBuilder,
  ) {}

  lookup(
    messages: TUniversalMessage[],
    model: string,
    provider: string,
    options?: { temperature?: number; maxTokens?: number },
  ): string | undefined {
    const key = this.keyBuilder.build(messages, model, provider, options);
    const entry = this.storage.get(key.hash);
    return entry ? entry.response : undefined;
  }

  store(
    messages: TUniversalMessage[],
    model: string,
    provider: string,
    response: string,
    options?: { temperature?: number; maxTokens?: number },
  ): void {
    const key = this.keyBuilder.build(messages, model, provider, options);
    this.storage.set({
      key,
      response,
      timestamp: Date.now(),
      integrityHash: this.keyBuilder.computeIntegrityHash(response),
    });
  }

  getStats(): ICacheStats {
    return this.storage.getStats();
  }
}

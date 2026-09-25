import type { CacheKeyBuilder } from './cache-key-builder';
import type { ICacheStorage, ICacheStats } from '../../interfaces/cache';
import type { TUniversalMessage } from '../../interfaces/messages';

/**
 * DATA-007/API-001: `effortCacheIdentity` is the caller-decided effort identity — the resolved
 * effective effort when the caller could verify it locally, or an identity derived from the raw
 * selection when it could not (see `CacheKeyBuilder`'s own doc for why the latter matters). `lookup`
 * and `store` both funnel through the SAME `keyBuilder.build` call below, so they can never drift
 * into separate identity rules for the same request.
 */
interface IExecutionCacheOptions {
  temperature?: number;
  maxTokens?: number;
  effortCacheIdentity?: string | null;
}

export class ExecutionCacheService {
  constructor(
    private readonly storage: ICacheStorage,
    private readonly keyBuilder: CacheKeyBuilder,
  ) {}

  lookup(
    messages: TUniversalMessage[],
    model: string,
    provider: string,
    options?: IExecutionCacheOptions,
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
    options?: IExecutionCacheOptions,
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

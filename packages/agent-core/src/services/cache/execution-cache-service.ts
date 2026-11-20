import type { CacheKeyBuilder, ICacheKeyOptions } from './cache-key-builder';
import type { ICacheStorage, ICacheStats } from '../../interfaces/cache';
import type { TUniversalMessage } from '../../interfaces/messages';

/**
 * `effortCacheIdentity` is the session's raw effort SELECTION (see
 * `CacheKeyBuilder`'s own doc for why it is the selection and not a resolved value). `lookup` and
 * `store` both funnel through the SAME `keyBuilder.build` call below, so they can never drift into
 * separate identity rules for the same request.
 */
export class ExecutionCacheService {
  constructor(
    private readonly storage: ICacheStorage,
    private readonly keyBuilder: CacheKeyBuilder,
  ) {}

  lookup(
    messages: TUniversalMessage[],
    model: string,
    provider: string,
    options?: ICacheKeyOptions,
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
    options?: ICacheKeyOptions,
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

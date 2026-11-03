import type { ICacheKey } from '../../interfaces/cache';
import type { TModelEffortSelection } from '../../interfaces/model-effort-capability';
import type { TUniversalMessage } from '../../interfaces/messages';
import { sha256Hex } from '../../utils/digest';

interface ICacheKeyOptions {
  temperature?: number;
  maxTokens?: number;
  /**
   * DATA-007/API-001: the SESSION's effort selection (e.g. `'low'`, `'high'`, `'auto'`) — never a
   * locally resolved effective value. The selection is the single source of truth for this key: two
   * requests with different selections never share an entry, and two with the same selection always
   * do, independent of what any particular provider or executor would resolve it to. `null`/
   * `undefined` both mean "no selection was distinguished" and hash identically; the caller normalizes
   * an absent selection to `'auto'` before passing it in.
   */
  effortCacheIdentity?: TModelEffortSelection | null;
}

export class CacheKeyBuilder {
  build(
    messages: TUniversalMessage[],
    model: string,
    provider: string,
    options?: ICacheKeyOptions,
  ): ICacheKey {
    const serializable = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const payload = JSON.stringify({
      messages: serializable,
      model,
      provider,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
      effortCacheIdentity: options?.effortCacheIdentity ?? null,
    });

    return {
      hash: sha256Hex(payload),
      model,
      provider,
    };
  }

  computeIntegrityHash(content: string): string {
    return sha256Hex(content);
  }
}

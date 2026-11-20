import type { ICacheKey } from '../../interfaces/cache';
import type { TModelEffortSelection } from '../../interfaces/model-effort-capability';
import type { TUniversalMessage } from '../../interfaces/messages';
import type { IChatOptions } from '../../interfaces/provider';
import { sha256Hex } from '../../utils/digest';

export type TCacheRequestIdentity = Pick<
  IChatOptions,
  | 'toolChoice'
  | 'nativeWebTools'
  | 'responseFormat'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'effortResolution'
  | 'preserveContextWindow'
>;

export interface ICacheKeyOptions {
  temperature?: number;
  maxTokens?: number;
  /**
   * The SESSION's effort selection (e.g. `'low'`, `'high'`, `'auto'`) — never a
   * locally resolved effective value. The selection is the single source of truth for this key: two
   * requests with different selections never share an entry, and two with the same selection always
   * do, independent of what any particular provider or executor would resolve it to. `null`/
   * `undefined` both mean "no selection was distinguished" and hash identically; the caller normalizes
   * an absent selection to `'auto'` before passing it in.
   */
  effortCacheIdentity?: TModelEffortSelection | null;
  requestIdentity?: TCacheRequestIdentity;
}

export class CacheKeyBuilder {
  build(
    messages: TUniversalMessage[],
    model: string,
    provider: string,
    options?: ICacheKeyOptions,
  ): ICacheKey {
    const serializable = messages.map((message) => {
      const { id, timestamp, metadata, ...requestMessage } = message;
      void id;
      void timestamp;
      if (!metadata) return requestMessage;
      // This host-owned attribution changes for each run but is not part of the prompt.
      const { executionId, ...requestMetadata } = metadata;
      void executionId;
      return Object.keys(requestMetadata).length > 0
        ? { ...requestMessage, metadata: requestMetadata }
        : requestMessage;
    });

    const payload = JSON.stringify({
      version: 2,
      messages: serializable,
      model,
      provider,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
      effortCacheIdentity: options?.effortCacheIdentity ?? null,
      requestIdentity: options?.requestIdentity,
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

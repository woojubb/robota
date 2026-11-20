import type { ICacheKey } from '../../interfaces/cache';
import type { TModelEffortSelection } from '../../interfaces/model-effort-capability';
import type { TUniversalMessage } from '../../interfaces/messages';
import type { IChatOptions } from '../../interfaces/provider';
import { sha256Hex } from '../../utils/digest';

export type TCacheRequestIdentity = Pick<
  IChatOptions,
  | 'tools'
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
  providerScope?: string;
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

function requestMessages(messages: TUniversalMessage[]) {
  return messages.map((message) => {
    const { id, timestamp, metadata, ...requestMessage } = message;
    void id;
    void timestamp;
    if (!metadata) return requestMessage;
    // This host-owned attribution changes for each run but is not part of the prompt.
    const { executionId, ...requestMetadata } = metadata;
    void executionId;
    return { ...requestMessage, metadata: requestMetadata };
  });
}

function cachePayload(
  messages: TUniversalMessage[],
  model: string,
  provider: string,
  options?: ICacheKeyOptions,
) {
  return {
    version: 3,
    messages: requestMessages(messages),
    model,
    provider,
    ...(options?.temperature !== undefined && { temperature: options.temperature }),
    ...(options?.maxTokens !== undefined && { maxTokens: options.maxTokens }),
    ...(options?.providerScope !== undefined && { providerScope: options.providerScope }),
    effortCacheIdentity: options?.effortCacheIdentity ?? null,
    ...(options?.requestIdentity !== undefined && { requestIdentity: options.requestIdentity }),
  };
}

/** JSON must distinguish every retained value; otherwise the cache is bypassed. */
function isLosslessJson(value: unknown, seen: WeakSet<object>): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0);
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) return false;
    if (Reflect.ownKeys(value).length !== value.length + 1) return false;
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !('value' in descriptor)) return false;
      if (!isLosslessJson(descriptor.value, seen)) return false;
    }
    return true;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) return false;
    if (!isLosslessJson(descriptor.value, seen)) return false;
  }
  return true;
}

export function isCacheIdentitySafe(
  messages: TUniversalMessage[],
  model: string,
  provider: string,
  options?: ICacheKeyOptions,
): boolean {
  try {
    for (const message of messages) {
      if (!isPlainDataObject(message)) return false;
      if (message.metadata !== undefined && !isPlainDataObject(message.metadata)) return false;
    }
    return isLosslessJson(cachePayload(messages, model, provider, options), new WeakSet());
  } catch {
    return false;
  }
}

function isPlainDataObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === 'string' && descriptor?.enumerable === true && 'value' in descriptor;
  });
}

export class CacheKeyBuilder {
  build(
    messages: TUniversalMessage[],
    model: string,
    provider: string,
    options?: ICacheKeyOptions,
  ): ICacheKey {
    const payload = JSON.stringify(cachePayload(messages, model, provider, options));

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

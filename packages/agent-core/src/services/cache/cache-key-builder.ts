import jsSHA from 'jssha';

import type { ICacheKey } from '../../interfaces/cache';
import type { TUniversalMessage } from '../../interfaces/messages';

interface ICacheKeyOptions {
  temperature?: number;
  maxTokens?: number;
  /**
   * DATA-007/API-001: the caller decides what this identifies.
   *
   * When the caller could locally resolve the effort against a verified table, this is the
   * EFFECTIVE (resolved) value actually sent — two requests whose raw selections differ but whose
   * resolution landed on the same effective effort (e.g. an explicit selection vs. `auto` resolving
   * to the same model default) then produce the same key, while two that resolve to different
   * effective efforts do not.
   *
   * When the caller could NOT locally resolve it (no verified table entry — e.g. a remote executor
   * that forwards the raw selection and lets the SERVER-side adapter resolve it, or a local table
   * missing this exact model), the actual outcome is unknown here, so the caller must pass an
   * identity derived from the raw SELECTION instead (never a bare "not applied" that erases which
   * selection was requested) — otherwise two different unresolved selections would collide into one
   * cache entry despite possibly producing different provider requests. `null`/`undefined` both mean
   * "nothing distinguishes this request by effort" and hash identically.
   */
  effortCacheIdentity?: string | null;
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
      hash: this.sha256(payload),
      model,
      provider,
    };
  }

  computeIntegrityHash(content: string): string {
    return this.sha256(content);
  }

  private sha256(input: string): string {
    const shaObj = new jsSHA('SHA-256', 'TEXT');
    shaObj.update(input);
    return shaObj.getHash('HEX');
  }
}

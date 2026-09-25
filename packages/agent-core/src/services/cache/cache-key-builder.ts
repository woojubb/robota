import jsSHA from 'jssha';

import type { ICacheKey } from '../../interfaces/cache';
import type { TModelEffort } from '../../interfaces/model-effort-capability';
import type { TUniversalMessage } from '../../interfaces/messages';

interface ICacheKeyOptions {
  temperature?: number;
  maxTokens?: number;
  /**
   * DATA-007: the EFFECTIVE (resolved) model effort actually sent to the provider, never the raw
   * requested selection — two requests whose selections differ but whose resolution landed on the
   * same effective effort (e.g. an explicit selection vs. `auto` resolving to the same model default)
   * must produce the same key, while two requests that resolve to different effective efforts must
   * not. `null`/`undefined` both mean "no effort was applied" and hash identically.
   */
  effectiveEffort?: TModelEffort | null;
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
      effectiveEffort: options?.effectiveEffort ?? null,
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

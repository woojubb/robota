// Imported from the DECLARING module, not the package barrel (see the sibling doubles).
import type { ISessionLoadOptions } from '../session-store-contracts.js';

/** What a store double's `load` answers, which its claim answers with too. */
type TLoadAnswer<TStore> = TStore extends { load(...args: never[]): infer TOutcome }
  ? TOutcome
  : never;

/**
 * `store`, given the claim members every store offers: a claim that answers with the store's own hold
 * read and ends at its release, a lend that counts as a claim until it ends, and `hasWriter`, which
 * is whether either is live. For a store double in a test that is not about claims — exclusivity, the
 * writer marker and the write fence are the real stores' to keep, and their own tests hold them to
 * it. The same object is returned, so a spy set on it before or after still sees every call.
 */
export function withHoldReadClaim<TStore extends object>(
  store: TStore,
): TStore & {
  claim(id: string): { readonly outcome: TLoadAnswer<TStore>; release(): void };
  lend(id: string): { readonly nonce: string; end(): void };
  hasWriter(id: string): boolean;
} {
  const loading = store as { load(id: string, options?: ISessionLoadOptions): unknown };
  const live = new Map<string, number>();
  let lends = 0;
  return Object.assign(store, {
    lend: (id: string) => {
      live.set(id, (live.get(id) ?? 0) + 1);
      let ended = false;
      lends += 1;
      return {
        nonce: `lease-${lends}`,
        end: (): void => {
          if (ended) return;
          ended = true;
          const left = (live.get(id) ?? 1) - 1;
          if (left > 0) live.set(id, left);
          else live.delete(id);
        },
      };
    },
    claim: (id: string) => {
      const outcome = loading.load(id, { hold: true }) as TLoadAnswer<TStore>;
      live.set(id, (live.get(id) ?? 0) + 1);
      let released = false;
      return {
        outcome,
        release: (): void => {
          if (released) return;
          released = true;
          const left = (live.get(id) ?? 1) - 1;
          if (left > 0) live.set(id, left);
          else live.delete(id);
        },
      };
    },
    hasWriter: (id: string): boolean => live.has(id),
  });
}

import type { TMarketplaceSource } from './marketplace-types.js';

/**
 * Where a marketplace's bytes come from.
 *
 * Split out of `marketplace-client.ts` under SEC-018 (issue #2020), by responsibility rather than by
 * line count: the client MANAGES registered marketplaces — register, update, remove, and the
 * containment rules that govern each — while this answers a single question about a source
 * descriptor. It is a total function over the source union with no filesystem or process access,
 * which is exactly why it does not belong inside a class that owns both.
 *
 * The `throw` cases are deliberate and are not errors of omission: `local` never clones, and `url` is
 * a declared-but-unimplemented source. Returning a placeholder for either would hand a caller a value
 * that looks like a clone URL and is not one.
 */
export function resolveMarketplaceCloneUrl(source: TMarketplaceSource): string {
  switch (source.type) {
    case 'github':
      return `https://github.com/${source.repo}.git`;
    case 'git':
      return source.url;
    case 'local':
      throw new Error('Local source type does not use git cloning');
    case 'url':
      throw new Error('URL marketplace source is not yet supported');
  }
}

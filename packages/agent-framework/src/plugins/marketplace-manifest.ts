import { assertSafePluginSegment } from './plugin-paths.js';

import type { IMarketplaceManifest } from './marketplace-types.js';
import type { IFileSystem } from '@robota-sdk/agent-core';

/**
 * Reading a `marketplace.json` and proving it is one.
 *
 * Split out of `marketplace-client.ts` under SEC-018 (issue #2020), and by responsibility rather than
 * by line count: the client MANAGES marketplaces — clone, rename, register, update, remove — while
 * this decides whether a file fetched from a remote repository is a manifest at all. They fail
 * differently and are read by different questions, and keeping them together is what let a manifest
 * be `data as IMarketplaceManifest` after two shallow checks.
 *
 * The validation runs HERE rather than only at the sink so a malformed manifest is refused before any
 * filesystem mutation is attempted, rather than partway through one. That ordering is the acceptance
 * criterion "failed validation performs no filesystem mutation", and it cannot be satisfied by a check
 * that lives next to the `renameSync`.
 */
export function readMarketplaceManifest(path: string, fs: IFileSystem): IMarketplaceManifest {
  const raw = fs.readFileSync(path, 'utf-8');
  const data: unknown = JSON.parse(raw);

  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid marketplace manifest: not an object');
  }

  const obj = data as Record<string, unknown>;
  if (typeof obj.name !== 'string') {
    throw new Error('Invalid marketplace manifest: missing "name" field');
  }
  // SEC-018: this name selects a rename destination in the client. A manifest named
  // `../../escaped-market` placed the marketplace outside its root.
  assertSafePluginSegment(obj.name, 'marketplace name');

  return data as IMarketplaceManifest;
}

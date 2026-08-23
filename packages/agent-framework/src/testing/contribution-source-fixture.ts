import { createNodeHostContributionSource } from '../contributions/index.js';

import type { IContributionSource } from '../contributions/index.js';

/** Test-only shorthand for explicit host-owned fixture roots. */
export function createNodeHostContributionSourcesFixture(
  ...roots: readonly string[]
): readonly IContributionSource[] {
  return [...new Set(roots)].map(createNodeHostContributionSource);
}

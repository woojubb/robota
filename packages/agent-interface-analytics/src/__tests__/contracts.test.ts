import { describe, expectTypeOf, it } from 'vitest';

import type {
  IRunTraceTurn,
  IUsageBySourceReport,
  IUsageSnapshot,
  IUsageSource,
  IUsageSourceTotals,
} from '../index.js';

/**
 * The usage-contract assertions, moved here with their declarations by ARCH-105 (issue #2112).
 *
 * `IUsageSnapshot` was asserted in `agent-interface-transport`'s `contracts.test.ts` beside
 * transport-adapter assertions; the rest were not asserted anywhere. Extracting the family was the
 * moment to notice that, so the four that had no assertion now have one.
 */
describe('analytics contract surface', () => {
  it('exports the per-turn usage snapshot', () => {
    expectTypeOf<IUsageSnapshot>().toHaveProperty('totalTokens');
    expectTypeOf<IUsageSnapshot>().toHaveProperty('costStatus');
  });

  it('attributes usage to an execution source', () => {
    expectTypeOf<IUsageSource>().toHaveProperty('scope');
    expectTypeOf<IUsageSourceTotals>().toHaveProperty('key');
    expectTypeOf<IUsageSourceTotals>().toHaveProperty('costExact');
  });

  it('exports the run-trace read model that crosses the sidecar boundary', () => {
    expectTypeOf<IUsageBySourceReport>().toHaveProperty('bySource');
    expectTypeOf<IUsageBySourceReport>().toHaveProperty('timeline');
    expectTypeOf<IRunTraceTurn>().toHaveProperty('spans');
  });
});

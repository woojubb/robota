import { describe, expect, expectTypeOf, it } from 'vitest';

import { createTransportFailedOutcome, isTransportRunOutcome } from '../index.js';

import type {
  IConfigurableTransport,
  ITransportAdapter,
  ITransportCompletionRecord,
  ITransportConfig,
  ITransportRunnerAdapter,
  TTransportRunOutcome,
} from '../index.js';

/**
 * Type-import test (TC-01): asserts the transport-facing contract closure is exported
 * from @robota-sdk/agent-interface-transport and that the key contract shapes resolve.
 */
describe('agent-interface-transport contract surface', () => {
  it('exports the transport adapter contracts', () => {
    expectTypeOf<ITransportAdapter>().toBeObject();
    expectTypeOf<ITransportAdapter>().toHaveProperty('lifecycle');
    expectTypeOf<ITransportRunnerAdapter>().toHaveProperty('waitForCompletion');
    expectTypeOf<TTransportRunOutcome>().not.toBeNever();
    expectTypeOf<ITransportCompletionRecord>().toHaveProperty('outcome');
    expectTypeOf<ITransportConfig>().toBeObject();
    expectTypeOf<IConfigurableTransport>().toBeObject();
  });

  it('constructs and recognizes only nonzero integer failure outcomes', () => {
    expect(createTransportFailedOutcome(2)).toEqual({ status: 'failed', exitCode: 2 });
    for (const invalid of [-1, 0, 1.5, 256, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createTransportFailedOutcome(invalid)).toThrow(/integer from 1 through 255/i);
      expect(isTransportRunOutcome({ status: 'failed', exitCode: invalid })).toBe(false);
    }
  });
});

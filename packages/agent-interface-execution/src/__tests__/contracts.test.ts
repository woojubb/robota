import { describe, expectTypeOf, it } from 'vitest';

import type { IExecutionWorkspaceEntry } from '../index.js';

/**
 * The workspace-entry shape assertion, moved here with its type by ARCH-103 (issue #2109).
 *
 * It lived in `agent-interface-transport`'s `contracts.test.ts` alongside assertions about transport
 * adapters. Splitting it rather than deleting it is the point: the assertion is about a contract this
 * package now owns, and leaving it behind would have asserted a type the transport package no longer
 * declares.
 */
describe('execution workspace contracts', () => {
  it('an execution workspace entry carries its origin', () => {
    expectTypeOf<IExecutionWorkspaceEntry>().toHaveProperty('origin');
  });
});

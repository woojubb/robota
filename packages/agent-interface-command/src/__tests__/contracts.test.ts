import { describe, expectTypeOf, it } from 'vitest';

import type {
  ICapabilityDescriptor,
  ICommand,
  ICommandListEntry,
  ICommandPluginAdapter,
  ICommandResult,
  TCommandHostAction,
} from '../index.js';

/**
 * The command-system contract assertions, moved here with their types by ARCH-104 (issue #2108).
 *
 * They lived in `agent-interface-transport`'s `contracts.test.ts` beside transport-adapter
 * assertions. Splitting rather than deleting is the point: each asserts a contract this package now
 * owns, and leaving them behind would have asserted types the transport package no longer declares.
 *
 * `ICapabilityDescriptor` is asserted here deliberately. It has no consumer outside this package —
 * `command-contracts` is its only importer — and the owner ruled on issue #2177 that it stays
 * publicly exported. This assertion is what makes that a checked property rather than an intention.
 */
describe('command contract surface', () => {
  it('exports the command-system contracts', () => {
    expectTypeOf<ICommand>().toHaveProperty('name');
    expectTypeOf<ICommandResult>().toHaveProperty('success');
    expectTypeOf<ICommandListEntry>().toHaveProperty('name');
    expectTypeOf<ICommandPluginAdapter>().toHaveProperty('reloadPlugins');
    expectTypeOf<ICapabilityDescriptor>().toHaveProperty('kind');
    expectTypeOf<TCommandHostAction>().not.toBeNever();
  });
});

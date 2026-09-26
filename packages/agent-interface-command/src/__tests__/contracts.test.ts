import { describe, expectTypeOf, it } from 'vitest';

import type {
  ICapabilityDescriptor,
  ICommand,
  ICommandListEntry,
  ICommandPluginAdapter,
  ICommandResult,
  ICommandSubcommandEntry,
  TCommandHostAction,
  TCommandRunner,
  TCommandSurface,
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

  it('requires a listing entry to say who runs the command', () => {
    // Required, not optional: `{ runner?: … }` would not equal `{ runner: … }`.
    expectTypeOf<Pick<ICommandListEntry, 'runner'>>().toEqualTypeOf<{
      runner: TCommandRunner;
    }>();
    expectTypeOf<TCommandRunner>().toEqualTypeOf<'runtime' | 'client'>();
    expectTypeOf<ICommandListEntry['surfaces']>().toEqualTypeOf<
      readonly TCommandSurface[] | undefined
    >();

    // @ts-expect-error — an entry that does not say who runs it is not a listing entry.
    const unsaid: ICommandListEntry = { name: 'x', description: 'x', modelInvocable: false };
    void unsaid;
  });

  it('lets a command declare its runner and surfaces, both optional', () => {
    expectTypeOf<ICommand['runner']>().toEqualTypeOf<TCommandRunner | undefined>();
    expectTypeOf<ICommand['surfaces']>().toEqualTypeOf<readonly TCommandSurface[] | undefined>();
  });

  it('lets a listing entry carry its argument grammar and subcommands, both optional', () => {
    expectTypeOf<ICommandListEntry['argumentHint']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ICommandListEntry['subcommands']>().toEqualTypeOf<
      readonly ICommandSubcommandEntry[] | undefined
    >();
    expectTypeOf<ICommandSubcommandEntry>().toEqualTypeOf<{
      readonly name: string;
      readonly description: string;
      readonly displayName?: string;
      readonly argumentHint?: string;
    }>();
  });
});

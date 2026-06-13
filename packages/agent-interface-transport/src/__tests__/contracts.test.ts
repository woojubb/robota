import { describe, expectTypeOf, it } from 'vitest';

import type {
  IActionRequest,
  ICapabilityDescriptor,
  ICommand,
  ICommandInteraction,
  ICommandListEntry,
  ICommandPluginAdapter,
  ICommandResult,
  IConfigurableTransport,
  IExecutionResult,
  IExecutionWorkspaceEntry,
  IInteractionChannel,
  IInteractiveSession,
  IInteractiveSessionStore,
  IResumableSessionSummary,
  IToolState,
  ITransportAdapter,
  ITransportConfig,
  IUsageSnapshot,
  TCommandEffect,
  TPermissionResultValue,
} from '../index.js';

/**
 * Type-import test (TC-01): asserts the transport-facing contract closure is exported
 * from @robota-sdk/agent-interface-transport and that the key contract shapes resolve.
 */
describe('agent-interface-transport contract surface', () => {
  it('exports the transport adapter contracts', () => {
    expectTypeOf<ITransportAdapter>().toBeObject();
    expectTypeOf<ITransportConfig>().toBeObject();
    expectTypeOf<IConfigurableTransport>().toBeObject();
  });

  it('exports the command-system contracts', () => {
    expectTypeOf<ICommand>().toHaveProperty('name');
    expectTypeOf<ICommandResult>().toHaveProperty('success');
    expectTypeOf<ICommandInteraction>().toHaveProperty('prompt');
    expectTypeOf<ICommandListEntry>().toHaveProperty('name');
    expectTypeOf<ICommandPluginAdapter>().toHaveProperty('reloadPlugins');
    expectTypeOf<ICapabilityDescriptor>().toHaveProperty('kind');
    expectTypeOf<TCommandEffect>().not.toBeNever();
  });

  it('exports the interaction-channel contracts', () => {
    expectTypeOf<IInteractionChannel>().toHaveProperty('requestAction');
    expectTypeOf<IActionRequest>().not.toBeNever();
  });

  it('exports the interactive-session contracts', () => {
    expectTypeOf<IInteractiveSession>().toHaveProperty('submit');
    expectTypeOf<IExecutionResult>().toHaveProperty('response');
    expectTypeOf<IToolState>().toHaveProperty('toolName');
    expectTypeOf<IUsageSnapshot>().toHaveProperty('totalTokens');
    expectTypeOf<TPermissionResultValue>().not.toBeNever();
    expectTypeOf<IInteractiveSessionStore>().toHaveProperty('save');
    expectTypeOf<IResumableSessionSummary>().toHaveProperty('messageCount');
  });

  it('exports the execution-workspace contracts', () => {
    expectTypeOf<IExecutionWorkspaceEntry>().toHaveProperty('origin');
  });
});

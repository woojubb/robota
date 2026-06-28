import { describe, expectTypeOf, it } from 'vitest';

import type {
  ICapabilityDescriptor,
  ICommand,
  ICommandListEntry,
  ICommandPluginAdapter,
  ICommandResult,
  IConfigurableTransport,
  IExecutionResult,
  IExecutionWorkspaceEntry,
  IAgentDriver,
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
    expectTypeOf<ICommandListEntry>().toHaveProperty('name');
    expectTypeOf<ICommandPluginAdapter>().toHaveProperty('reloadPlugins');
    expectTypeOf<ICapabilityDescriptor>().toHaveProperty('kind');
    expectTypeOf<TCommandEffect>().not.toBeNever();
  });

  it('exports the interaction-channel contracts', () => {
    expectTypeOf<IInteractionChannel>().toHaveProperty('askUser');
    expectTypeOf<IAgentDriver>().toHaveProperty('send');
    expectTypeOf<IAgentDriver>().toHaveProperty('events');
    expectTypeOf<IAgentDriver>().toHaveProperty('queueUserAction');
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

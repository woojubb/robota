import { describe, expectTypeOf, it } from 'vitest';

import type {
  IAgentDriver,
  IExecutionResult,
  IInteractionChannel,
  IInteractiveSession,
  IInteractiveSessionStore,
  IResumableSessionSummary,
  IToolState,
  TPermissionResultValue,
} from '../index.js';

/**
 * The interaction-channel and interactive-session contract assertions, moved here with their
 * declarations by ARCH-108 (issue #2113).
 *
 * They were the last thing in `agent-interface-transport`'s own contract test naming a type that
 * package no longer owns — a test asserting a foreign contract, which is the same coupling the
 * decomposition removed everywhere else and the last place it survived.
 */
describe('session contract surface', () => {
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
    expectTypeOf<TPermissionResultValue>().not.toBeNever();
    expectTypeOf<IInteractiveSessionStore>().toHaveProperty('save');
    expectTypeOf<IInteractiveSessionStore>().not.toHaveProperty('getFilePath');
    expectTypeOf<IResumableSessionSummary>().toHaveProperty('messageCount');
  });
});

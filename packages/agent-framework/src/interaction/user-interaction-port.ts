/**
 * Builds the guarded "ask the user" port for a session (CMD-004).
 *
 * Kept as a pure function (separate from the InteractiveSession god-class) so the model-invocation
 * guard is unit-testable without constructing a session.
 */

import type { TCommandInvocationSource } from '../command-api/host-context.js';
import type { IUserInteraction, TActionResponse } from '@robota-sdk/agent-core';

/**
 * Return the injected ask port, or `undefined` when no ask handler is attached (headless/automation —
 * callers treat absence as "no human available", never a silent guess).
 *
 * When the active command was invoked by the model, the port resolves `cancelled` instead of asking:
 * a model-invoked command runs inside an executing turn, where blocking on a human prompt would
 * deadlock. (Letting the model issue an interactive ask is CMD-005's separate turn-suspension design.)
 */
export function createUserInteractionPort(
  handler: IUserInteraction['ask'] | undefined,
  getInvocationSource: () => TCommandInvocationSource,
): IUserInteraction | undefined {
  if (!handler) return undefined;
  const cancelled: TActionResponse = { type: 'cancelled' };
  return {
    ask: (request) =>
      getInvocationSource() === 'model' ? Promise.resolve(cancelled) : handler(request),
  };
}

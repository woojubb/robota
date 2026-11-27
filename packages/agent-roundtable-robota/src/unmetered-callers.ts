import { isManagedRunProvider } from '@robota-sdk/agent-core';
import type { IHookTypeExecutor, TExecutionProvider } from '@robota-sdk/agent-core';
import { RuntimeParticipantError } from './errors';

/** What a runtime is configured to call a provider through, as far as the adapter can see. */
export interface CallerSurface {
  providers: readonly TExecutionProvider[];
  permissionClassifier?: unknown;
  hookTypeExecutors?: readonly Pick<IHookTypeExecutor, 'type'>[];
}

function refuse(message: string): never {
  throw new RuntimeParticipantError('unmetered-caller', message);
}

/**
 * Refuse a runtime that reaches a provider by a path the turn journal never records, or that
 * sends one admitted call on to several models: no limit can count a call it never sees.
 * Runs before any provider call or lease, in every metering mode.
 */
export function assertCallersAreMetered(surface: CallerSurface): void {
  if (surface.permissionClassifier !== undefined)
    refuse(
      'A permission classifier calls a provider outside the turn journal, so its calls cannot be admitted',
    );
  for (const provider of surface.providers) {
    if (typeof (provider as { resolveModelRoute?: unknown }).resolveModelRoute === 'function')
      refuse(
        'A provider that can move a request to another model sends one admitted call to several, so its calls cannot be counted',
      );
    if (isManagedRunProvider(provider))
      refuse('A managed-run provider makes calls the turn journal never sees');
  }
  if (surface.hookTypeExecutors?.some((e) => e.type === 'prompt' || e.type === 'agent'))
    refuse(
      'A model-backed hook executor calls a provider outside the turn journal, so its calls cannot be admitted',
    );
}

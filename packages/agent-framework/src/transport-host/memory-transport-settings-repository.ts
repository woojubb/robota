/**
 * The in-memory `ITransportSettingsRepository` — for tests and for hosts that
 * keep transport settings elsewhere. The file-backed one is `createFileTransportSettingsRepository`
 * on `@robota-sdk/agent-framework/node`.
 */

import type {
  ITransportSavedConfig,
  ITransportSettingsRepository,
} from '@robota-sdk/agent-interface-transport';

/** Holds transport settings in memory — tests, and hosts with no settings file. */
export function createMemoryTransportSettingsRepository(
  initial: Record<string, ITransportSavedConfig> = {},
): ITransportSettingsRepository {
  const store: Record<string, ITransportSavedConfig> = { ...initial };
  return {
    readAll: () => ({ ...store }),
    write(name, saved) {
      store[name] = { ...(store[name] ?? {}), ...saved };
    },
  };
}

/**
 * TRANS-010 (issue #2480): the two `ITransportSettingsRepository` implementations this package ships.
 *
 * The file-backed one is the ONLY place the transport package touches the framework settings
 * helpers; the settings view and registry see the port. The in-memory one is for tests and for
 * hosts that keep transport settings elsewhere.
 */

import { readSettings, writeSettings, type TSettingsData } from '@robota-sdk/agent-framework';

import type {
  ITransportSavedConfig,
  ITransportSettingsRepository,
} from '@robota-sdk/agent-interface-transport';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toSavedConfig(value: unknown): ITransportSavedConfig {
  if (!isRecord(value)) return {};
  const saved: ITransportSavedConfig = {};
  if (typeof value['enabled'] === 'boolean') saved.enabled = value['enabled'];
  if (isRecord(value['options'])) saved.options = value['options'];
  return saved;
}

/** Reads/writes the `transports` section of one settings file. */
export function createFileTransportSettingsRepository(
  settingsPath: string,
): ITransportSettingsRepository {
  return {
    readAll(): Record<string, ITransportSavedConfig> {
      const raw = readSettings(settingsPath).transports;
      if (!isRecord(raw)) return {};
      return Object.fromEntries(Object.entries(raw).map(([name, v]) => [name, toSavedConfig(v)]));
    },
    write(name: string, saved: ITransportSavedConfig): void {
      const settings = readSettings(settingsPath);
      const transports = isRecord(settings.transports) ? settings.transports : {};
      transports[name] = { ...(isRecord(transports[name]) ? transports[name] : {}), ...saved };
      settings.transports = transports as TSettingsData;
      writeSettings(settingsPath, settings);
    },
  };
}

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

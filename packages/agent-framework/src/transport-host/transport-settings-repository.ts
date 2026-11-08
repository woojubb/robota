/**
 * The file-backed `ITransportSettingsRepository`, a Node adapter exported
 * from `@robota-sdk/agent-framework/node`.
 *
 * It is the ONLY place the transport package touches the framework settings file helpers; the
 * settings view and registry see the port. The in-memory one lives in
 * `memory-transport-settings-repository.ts`.
 */

import { readSettings, writeSettings } from '../config/settings-io.js';

import type { TSettingsData } from '../config/settings-store-types.js';
import type {
  ITransportSavedConfig,
  ITransportSettingsRepository,
} from '@robota-sdk/agent-interface/transport';

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
      // A fresh, widely-typed copy: the settings value type is the universal value union, which an
      // `ITransportSavedConfig` (its `options` is an open record) is not assignable to.
      const transports: Record<string, unknown> = {
        ...(isRecord(settings.transports) ? settings.transports : {}),
      };
      transports[name] = { ...(isRecord(transports[name]) ? transports[name] : {}), ...saved };
      settings.transports = transports as TSettingsData;
      writeSettings(settingsPath, settings);
    },
  };
}

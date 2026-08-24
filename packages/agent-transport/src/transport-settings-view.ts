/**
 * The persisted transport-config half of the registry, separated from the entry table.
 *
 * `TransportRegistry` does two jobs that only share a constructor argument: it holds WHICH adapters
 * exist and orchestrates their start/stop, and it reads and writes what the user saved ABOUT them.
 * The second one owns a settings path, a file format and a defaulting rule, and none of that is a
 * fact about the entry table.
 *
 * They were one 299-line file, one line under the anti-monolith limit, so the next addition had to
 * split something. This is the seam that was already there rather than a cut made to fit.
 */

import { readSettings, writeSettings, type TSettingsData } from '@robota-sdk/agent-framework';

import type { TUniversalValue } from '@robota-sdk/agent-core';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import type {
  ITransportConfig,
  TConfigurableTransport,
} from '@robota-sdk/agent-interface-transport';

/** Reads and writes the `transports` section of one settings file. */
export class TransportSettingsView {
  private readonly settingsPath: string;

  constructor(settingsPath: string) {
    this.settingsPath = settingsPath;
  }

  /** Every saved transport section, keyed by transport name. `{}` when absent or malformed. */
  readAll(): Record<string, TSettingsData> {
    const settings = readSettings(this.settingsPath);
    const raw = settings.transports;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw as Record<string, TSettingsData>;
  }

  /**
   * What a transport's config resolves to, given what was saved for it.
   *
   * The transport's own `defaultEnabled` is the fallback, so a transport nobody has configured
   * answers with its declared default rather than with `false`.
   */
  resolve(
    transport: TConfigurableTransport<IInteractiveSession>,
    saved?: TSettingsData,
  ): ITransportConfig {
    const enabled = (saved?.enabled as boolean | undefined) ?? transport.defaultEnabled;
    const options = (saved?.options as Record<string, TUniversalValue> | undefined) ?? {};
    return { enabled, options };
  }

  /** Persist `enabled` for one transport, leaving its other saved keys untouched. */
  setEnabled(name: string, enabled: boolean): void {
    this.mutate(name, (entry) => ({ ...entry, enabled }) as TSettingsData);
  }

  /** Persist `options` for one transport, leaving its other saved keys untouched. */
  setOptions(name: string, options: Record<string, TUniversalValue>): void {
    this.mutate(
      name,
      (entry) => ({ ...entry, options: options as TSettingsData }) as TSettingsData,
    );
  }

  private mutate(name: string, next: (entry: TSettingsData) => TSettingsData): void {
    const settings = readSettings(this.settingsPath);
    const transports = (settings.transports ?? {}) as TSettingsData;
    const entry = (transports[name] ?? {}) as TSettingsData;
    transports[name] = next(entry);
    settings.transports = transports;
    writeSettings(this.settingsPath, settings);
  }
}

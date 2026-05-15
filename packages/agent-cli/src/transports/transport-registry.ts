/**
 * TransportRegistry — manages IConfigurableTransport instances with settings-backed enable/disable.
 *
 * Settings file shape (under `transports` key in settings.json):
 *   { "ws": { "enabled": true, "options": { "port": 7070 } } }
 */

import type { TUniversalValue } from '@robota-sdk/agent-core';
import type { IInteractiveSession } from '@robota-sdk/agent-sdk';
import type {
  IConfigurableTransport,
  ITransportConfig,
  ITransportEntry,
} from '@robota-sdk/agent-interface-transport';
import { readSettings, writeSettings, type TSettingsData } from '../utils/settings-io.js';

export class TransportRegistry {
  private readonly entries = new Map<string, IConfigurableTransport<IInteractiveSession>>();
  private readonly settingsPath: string;

  constructor(settingsPath: string) {
    this.settingsPath = settingsPath;
  }

  register(transport: IConfigurableTransport<IInteractiveSession>): void {
    this.entries.set(transport.name, transport);
  }

  getAll(): ITransportEntry<IInteractiveSession>[] {
    const saved = this.readTransportSettings();
    return Array.from(this.entries.values()).map((transport) => ({
      transport,
      config: this.resolveConfig(transport, saved[transport.name]),
    }));
  }

  getEnabled(): IConfigurableTransport<IInteractiveSession>[] {
    return this.getAll()
      .filter((e) => e.config.enabled)
      .map((e) => e.transport);
  }

  async setEnabled(name: string, enabled: boolean): Promise<void> {
    const settings = readSettings(this.settingsPath);
    const transports = (settings.transports ?? {}) as TSettingsData;
    const entry = (transports[name] ?? {}) as TSettingsData;
    transports[name] = { ...entry, enabled } as TSettingsData;
    settings.transports = transports;
    writeSettings(this.settingsPath, settings);
  }

  async setOptions(name: string, options: Record<string, TUniversalValue>): Promise<void> {
    const settings = readSettings(this.settingsPath);
    const transports = (settings.transports ?? {}) as TSettingsData;
    const entry = (transports[name] ?? {}) as TSettingsData;
    transports[name] = { ...entry, options: options as TSettingsData } as TSettingsData;
    settings.transports = transports;
    writeSettings(this.settingsPath, settings);
  }

  async startAll(session: IInteractiveSession): Promise<void> {
    const enabled = this.getEnabled();
    for (const transport of enabled) {
      transport.attach(session);
      await transport.start();
    }
  }

  async stopAll(): Promise<void> {
    for (const transport of this.entries.values()) {
      await transport.stop();
    }
  }

  private resolveConfig(
    transport: IConfigurableTransport<IInteractiveSession>,
    saved?: TSettingsData,
  ): ITransportConfig {
    const enabled = (saved?.enabled as boolean | undefined) ?? transport.defaultEnabled;
    const options = (saved?.options as Record<string, TUniversalValue> | undefined) ?? {};
    return { enabled, options };
  }

  private readTransportSettings(): Record<string, TSettingsData> {
    const settings = readSettings(this.settingsPath);
    const raw = settings.transports;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw as Record<string, TSettingsData>;
  }
}

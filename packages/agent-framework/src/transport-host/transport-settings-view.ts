/**
 * The persisted transport-config half of the registry, separated from the entry table.
 *
 * `TransportRegistry` does two jobs that only share a constructor argument: it holds WHICH adapters
 * exist and orchestrates their start/stop, and it reads and writes what the user saved ABOUT them.
 *
 * TRANS-010 (issue #2480): this view performs no I/O of its own. It resolves and mutates through an
 * injected `ITransportSettingsRepository`, so the package's tests need no filesystem and a host may
 * store transport settings wherever it keeps the rest.
 */

import type { TUniversalValue } from '@robota-sdk/agent-core';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import type {
  ITransportConfig,
  ITransportSavedConfig,
  ITransportSettingsRepository,
  TConfigurableTransport,
} from '@robota-sdk/agent-interface-transport';

export class TransportSettingsView {
  constructor(private readonly repository: ITransportSettingsRepository) {}

  /** Every saved transport section, keyed by transport name. `{}` when absent. */
  readAll(): Record<string, ITransportSavedConfig> {
    return this.repository.readAll();
  }

  /**
   * What a transport's config resolves to, given what was saved for it.
   *
   * The transport's own `defaultEnabled` is the fallback, so a transport nobody has configured
   * answers with its declared default rather than with `false`.
   */
  resolve(
    transport: TConfigurableTransport<IInteractiveSession>,
    saved?: ITransportSavedConfig,
  ): ITransportConfig {
    return { enabled: saved?.enabled ?? transport.defaultEnabled, options: saved?.options ?? {} };
  }

  /** Persist `enabled` for one transport, leaving its other saved keys untouched. */
  setEnabled(name: string, enabled: boolean): void {
    this.repository.write(name, { enabled });
  }

  /** Persist `options` for one transport, leaving its other saved keys untouched. */
  setOptions(name: string, options: Record<string, TUniversalValue>): void {
    this.repository.write(name, { options });
  }
}

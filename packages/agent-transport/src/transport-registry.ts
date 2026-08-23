/** Transport lifecycle registry with optional settings capability per entry. */

import { readSettings, writeSettings, type TSettingsData } from '@robota-sdk/agent-framework';

import { TransportRunGeneration } from './transport-run-generation.js';

import type { IDestroyResult, TUniversalValue } from '@robota-sdk/agent-core';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import type {
  IConfigurableTransport,
  ITransportAdapter,
  ITransportCompletionRecord,
  ITransportConfig,
  ITransportEntry,
  ITransportFailureRecord,
  ITransportRunnerAdapter,
  ITransportStartupError,
  TConfigurableTransport,
  TTransportAdapter,
  TTransportConfigurationErrorCode,
} from '@robota-sdk/agent-interface-transport';

interface IRegistryEntry {
  readonly transport: TTransportAdapter<IInteractiveSession>;
  readonly configurable?: TConfigurableTransport<IInteractiveSession>;
}

function isConfigurableTransport(
  transport: TTransportAdapter<IInteractiveSession>,
): transport is TConfigurableTransport<IInteractiveSession> {
  return 'defaultEnabled' in transport && typeof transport.defaultEnabled === 'boolean';
}

function isRunnerTransport(
  transport: TTransportAdapter<IInteractiveSession>,
): transport is ITransportRunnerAdapter<IInteractiveSession> {
  return transport.lifecycle.kind === 'runner';
}

function configurationError(transportName: string, code: TTransportConfigurationErrorCode): Error {
  return Object.assign(new Error(`Transport ${transportName} is ${code}.`), {
    name: 'TransportConfigurationError' as const,
    code,
    transportName,
  });
}

function startupError(
  transportName: string,
  cause: unknown,
  rollbackErrors: ITransportStartupError['rollbackErrors'],
  rollbackCauses: readonly unknown[],
): ITransportStartupError {
  const error = Object.assign(new Error(`Transport ${transportName} failed during startup.`), {
    name: 'TransportStartupError' as const,
    transportName,
    rollbackErrors: Object.freeze([...rollbackErrors]),
  });
  Object.defineProperty(error, 'cause', { value: cause, enumerable: false });
  Object.defineProperty(error, 'rollbackCauses', {
    value: Object.freeze([...rollbackCauses]),
    enumerable: false,
  });
  return error;
}

type TRegistryState = 'idle' | 'starting' | 'active' | 'stopping';

export class TransportRegistry {
  private readonly entries = new Map<string, IRegistryEntry>();
  private readonly settingsPath: string;
  private generation: TransportRunGeneration | undefined;
  private state: TRegistryState = 'idle';
  private startOperation: Promise<void> | undefined;
  private stopOperation: Promise<IDestroyResult> | undefined;
  private preemptionStopOperation: Promise<void> | undefined;
  private startingTransport: TTransportAdapter<IInteractiveSession> | undefined;
  private preemptionStopFailure:
    { readonly transportName: string; readonly cause: unknown } | undefined;

  constructor(settingsPath: string) {
    this.settingsPath = settingsPath;
  }

  register(transport: TTransportAdapter<IInteractiveSession>): void {
    if (this.entries.has(transport.name)) {
      throw new Error(`Duplicate transport name: ${transport.name}`);
    }
    const hasCompletion =
      'waitForCompletion' in transport && typeof transport.waitForCompletion === 'function';
    if (
      (transport.lifecycle.kind === 'runner' && !hasCompletion) ||
      (transport.lifecycle.kind === 'service' && hasCompletion)
    ) {
      throw new TypeError(
        `Transport ${transport.name} has an invalid ${transport.lifecycle.kind} shape.`,
      );
    }
    this.entries.set(transport.name, {
      transport,
      configurable: isConfigurableTransport(transport) ? transport : undefined,
    });
  }

  getAll(): ITransportEntry<IInteractiveSession>[] {
    const saved = this.readTransportSettings();
    return [...this.entries.values()].flatMap(({ configurable }) =>
      configurable
        ? [
            {
              transport: configurable,
              config: this.resolveConfig(configurable, saved[configurable.name]),
            },
          ]
        : [],
    );
  }

  getEnabled(): TTransportAdapter<IInteractiveSession>[] {
    const saved = this.readTransportSettings();
    return [...this.entries.values()].flatMap(({ transport, configurable }) => {
      if (!configurable) return [transport];
      return this.resolveConfig(configurable, saved[transport.name]).enabled ? [transport] : [];
    });
  }

  async setEnabled(name: string, enabled: boolean): Promise<void> {
    this.requireConfigurable(name);
    const settings = readSettings(this.settingsPath);
    const transports = (settings.transports ?? {}) as TSettingsData;
    const entry = (transports[name] ?? {}) as TSettingsData;
    transports[name] = { ...entry, enabled } as TSettingsData;
    settings.transports = transports;
    writeSettings(this.settingsPath, settings);
  }

  async setOptions(name: string, options: Record<string, TUniversalValue>): Promise<void> {
    this.requireConfigurable(name);
    const settings = readSettings(this.settingsPath);
    const transports = (settings.transports ?? {}) as TSettingsData;
    const entry = (transports[name] ?? {}) as TSettingsData;
    transports[name] = { ...entry, options: options as TSettingsData } as TSettingsData;
    settings.transports = transports;
    writeSettings(this.settingsPath, settings);
  }

  async startAll(session: IInteractiveSession): Promise<void> {
    if (this.state !== 'idle') {
      throw Object.assign(new Error('Transport registry is already started.'), {
        name: 'TransportLifecycleError' as const,
        code: 'already-started' as const,
        transportName: 'transport-registry',
      });
    }
    const enabled = this.getEnabled();
    this.state = 'starting';
    const generation = new TransportRunGeneration(
      enabled.filter(isRunnerTransport).map(({ name }) => name),
    );
    this.generation = generation;
    const operation = this.performStart(generation, enabled, session);
    this.startOperation = operation;
    try {
      await operation;
    } finally {
      if (this.startOperation === operation) this.startOperation = undefined;
    }
  }

  waitForCompletion(): Promise<ITransportCompletionRecord[]> {
    return this.generation?.waitForCompletion() ?? Promise.resolve([]);
  }

  waitForFailure(): Promise<ITransportFailureRecord | undefined> {
    return this.generation?.waitForFailure() ?? Promise.resolve(undefined);
  }

  async stopAll(): Promise<IDestroyResult> {
    if (this.stopOperation) return this.stopOperation;
    const operation = this.performStop();
    this.stopOperation = operation;
    try {
      return await operation;
    } finally {
      if (this.stopOperation === operation) this.stopOperation = undefined;
    }
  }

  private async performStop(): Promise<IDestroyResult> {
    if (this.state === 'starting') {
      const generation = this.generation;
      if (generation) generation.stopRequested = true;
      const transportName = this.startingTransport?.name ?? 'transport-registry';
      const preemption = Promise.resolve()
        .then(() => this.startingTransport?.stop())
        .then(() => undefined)
        .catch((cause) => {
          this.preemptionStopFailure = { transportName, cause };
        });
      this.preemptionStopOperation = preemption;
      await preemption;
      try {
        await this.startOperation;
      } catch {
        // startAll owns its typed primary/rollback error; stopAll continues best-effort cleanup.
      }
    }
    this.state = 'stopping';
    const errors: Error[] = [];
    const generation = this.generation;
    if (generation) {
      generation.abandon('stopped');
    }

    for (const { transport } of this.entries.values()) {
      try {
        await transport.stop();
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    this.state = 'idle';
    return { errors };
  }

  private async performStart(
    generation: TransportRunGeneration,
    enabled: TTransportAdapter<IInteractiveSession>[],
    session: IInteractiveSession,
  ): Promise<void> {
    const attempted: TTransportAdapter<IInteractiveSession>[] = [];
    let currentName = 'transport-registry';
    try {
      for (const transport of enabled) {
        currentName = transport.name;
        attempted.push(transport);
        this.startingTransport = transport;
        transport.attach(session);
        await transport.start();
        if (generation.stopRequested) throw new Error('Transport startup was stopped.');
        if (isRunnerTransport(transport)) generation.track(transport);
      }
      generation.seal();
      this.startingTransport = undefined;
      this.state = 'active';
    } catch (cause) {
      await this.preemptionStopOperation;
      this.preemptionStopOperation = undefined;
      const rollbackErrors: Array<{ transportName: string; message: string }> = [];
      const rollbackCauses: unknown[] = [];
      if (this.preemptionStopFailure) {
        rollbackErrors.push({
          transportName: this.preemptionStopFailure.transportName,
          message: 'Transport stop failed during startup rollback.',
        });
        rollbackCauses.push(this.preemptionStopFailure.cause);
        this.preemptionStopFailure = undefined;
      }
      for (const transport of attempted.reverse()) {
        try {
          await transport.stop();
        } catch (rollbackCause) {
          rollbackErrors.push({
            transportName: transport.name,
            message: 'Transport stop failed during startup rollback.',
          });
          rollbackCauses.push(rollbackCause);
        }
      }
      this.startingTransport = undefined;
      generation.abandon('startup-rollback');
      this.state = 'idle';
      throw startupError(currentName, cause, rollbackErrors, rollbackCauses);
    }
  }

  private requireConfigurable(name: string): TConfigurableTransport<IInteractiveSession> {
    const entry = this.entries.get(name);
    if (!entry) throw configurationError(name, 'unknown-transport');
    if (!entry.configurable) throw configurationError(name, 'not-configurable');
    return entry.configurable;
  }

  private resolveConfig(
    transport: TConfigurableTransport<IInteractiveSession>,
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

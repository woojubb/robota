/** Transport lifecycle registry with optional settings capability per entry. */

import { configurationError, startupError } from './transport-registry-errors.js';
import { TransportRunGeneration } from './transport-run-generation.js';
import { createFileTransportSettingsRepository } from './transport-settings-repository.js';
import { TransportSettingsView } from './transport-settings-view.js';

import type { IDestroyResult, TUniversalValue } from '@robota-sdk/agent-core';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import type {
  ITransportCompletionRecord,
  ITransportEntry,
  ITransportFailureRecord,
  ITransportRunnerAdapter,
  ITransportSettingsRepository,
  TConfigurableTransport,
  TTransportAdapter,
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

type TRegistryState = 'idle' | 'starting' | 'active' | 'stopping';

export class TransportRegistry {
  private readonly entries = new Map<string, IRegistryEntry>();
  private readonly settings: TransportSettingsView;
  private generation: TransportRunGeneration | undefined;
  private state: TRegistryState = 'idle';
  private startOperation: Promise<void> | undefined;
  private stopOperation: Promise<IDestroyResult> | undefined;
  private preemptionStopOperation: Promise<void> | undefined;
  private startingTransport: TTransportAdapter<IInteractiveSession> | undefined;
  private preemptionStopFailure:
    { readonly transportName: string; readonly cause: unknown } | undefined;

  /**
   * TRANS-010 (issue #2480): settings storage is an injected repository. A string is accepted as the
   * path of a settings file and wrapped in the file repository, so the existing shell and tests keep
   * their call shape.
   */
  constructor(settings: string | ITransportSettingsRepository) {
    this.settings = new TransportSettingsView(
      typeof settings === 'string' ? createFileTransportSettingsRepository(settings) : settings,
    );
  }

  /** The lifecycle/shape agreement every entry must satisfy, on the way in and on a replace. */
  private assertRegisterableShape(transport: TTransportAdapter<IInteractiveSession>): void {
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
  }

  register(transport: TTransportAdapter<IInteractiveSession>): void {
    if (this.entries.has(transport.name)) {
      throw new Error(`Duplicate transport name: ${transport.name}`);
    }
    this.assertRegisterableShape(transport);
    this.entries.set(transport.name, {
      transport,
      configurable: isConfigurableTransport(transport) ? transport : undefined,
    });
  }

  /**
   * Swap the adapter registered under `transport.name` for a new instance of the same name.
   *
   * Narrower than an unregister: the name must ALREADY be registered and the count cannot change, so
   * `stopAll` keeps its promise to reach everything. An entry is a claim about WHICH instance is
   * live, and reconnect makes it false (issue #2043).
   *
   * Returns nothing and stops nothing: every caller that abandons an adapter already stops it on the
   * path that abandoned it, and a registry that stopped it here would do so at a moment the caller
   * did not choose.
   */
  replace(transport: TTransportAdapter<IInteractiveSession>): void {
    if (!this.entries.has(transport.name)) {
      throw new Error(
        `Cannot replace transport ${transport.name}: no transport is registered under that name.`,
      );
    }
    this.assertRegisterableShape(transport);
    this.entries.set(transport.name, {
      transport,
      configurable: isConfigurableTransport(transport) ? transport : undefined,
    });
  }

  getAll(): ITransportEntry<IInteractiveSession>[] {
    const saved = this.settings.readAll();
    return [...this.entries.values()].flatMap(({ configurable }) =>
      configurable
        ? [
            {
              transport: configurable,
              config: this.settings.resolve(configurable, saved[configurable.name]),
            },
          ]
        : [],
    );
  }

  getEnabled(): TTransportAdapter<IInteractiveSession>[] {
    const saved = this.settings.readAll();
    return [...this.entries.values()].flatMap(({ transport, configurable }) => {
      if (!configurable) return [transport];
      return this.settings.resolve(configurable, saved[transport.name]).enabled ? [transport] : [];
    });
  }

  async setEnabled(name: string, enabled: boolean): Promise<void> {
    this.requireConfigurable(name);
    this.settings.setEnabled(name, enabled);
  }

  async setOptions(name: string, options: Record<string, TUniversalValue>): Promise<void> {
    const transport = this.requireConfigurable(name);
    // TRANS-002: an option the transport would refuse is not persisted — the validation hook exists.
    if (transport.validateOptions && !transport.validateOptions(options)) {
      throw configurationError(name, 'invalid-options');
    }
    this.settings.setOptions(name, options);
  }

  /**
   * TRANS-002 (issue #2480): hand the persisted options to a transport BEFORE it starts. Non-empty
   * options a transport cannot receive (`configure` absent) or refuses (`validateOptions` false) are
   * a typed configuration error rather than a silent ignore — the former "read, displayed, never
   * applied" state.
   */
  private deliverOptions(transport: TTransportAdapter<IInteractiveSession>): void {
    const entry = this.entries.get(transport.name);
    if (!entry?.configurable) return;
    const saved = this.settings.readAll()[transport.name];
    const options = this.settings.resolve(entry.configurable, saved).options ?? {};
    if (Object.keys(options).length === 0) return;
    if (entry.configurable.validateOptions && !entry.configurable.validateOptions(options)) {
      throw configurationError(transport.name, 'invalid-options');
    }
    if (!entry.configurable.configure) {
      throw configurationError(transport.name, 'options-not-applicable');
    }
    entry.configurable.configure(options);
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
        this.deliverOptions(transport);
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
}

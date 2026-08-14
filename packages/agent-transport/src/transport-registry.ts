/**
 * TransportRegistry — one lifecycle registry with an optional settings capability per entry.
 */

import { readSettings, writeSettings, type TSettingsData } from '@robota-sdk/agent-framework';

import type { IDestroyResult, TUniversalValue } from '@robota-sdk/agent-core';
import type {
  IConfigurableTransport,
  IInteractiveSession,
  ITransportAdapter,
  ITransportCompletionRecord,
  ITransportConfig,
  ITransportEntry,
  ITransportLifecycleError,
  ITransportRunnerAdapter,
  TTransportConfigurationErrorCode,
} from '@robota-sdk/agent-interface-transport';

interface IRegistryEntry {
  readonly transport: ITransportAdapter<IInteractiveSession>;
  readonly configurable?: IConfigurableTransport<IInteractiveSession>;
}

interface IDeferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

interface IRunGeneration {
  active: boolean;
  sealed: boolean;
  pending: number;
  settled: boolean;
  failureSettled: boolean;
  readonly orderedNames: string[];
  readonly records: Map<string, ITransportCompletionRecord>;
  readonly completion: IDeferred<ITransportCompletionRecord[]>;
  readonly failure: IDeferred<ITransportCompletionRecord | undefined>;
}

function deferred<T>(): IDeferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function isConfigurableTransport(
  transport: ITransportAdapter<IInteractiveSession>,
): transport is IConfigurableTransport<IInteractiveSession> {
  return 'defaultEnabled' in transport && typeof transport.defaultEnabled === 'boolean';
}

function isRunnerTransport(
  transport: ITransportAdapter<IInteractiveSession>,
): transport is ITransportRunnerAdapter<IInteractiveSession> {
  return transport.lifecycle.kind === 'runner' && 'waitForCompletion' in transport;
}

function configurationError(transportName: string, code: TTransportConfigurationErrorCode): Error {
  return Object.assign(new Error(`Transport ${transportName} is ${code}.`), {
    name: 'TransportConfigurationError' as const,
    code,
    transportName,
  });
}

function lifecycleError(transportName: string, cause: unknown): ITransportLifecycleError {
  const error = Object.assign(new Error(`Runner ${transportName} rejected.`), {
    name: 'TransportLifecycleError' as const,
    code: 'runner-rejected' as const,
    transportName,
  });
  Object.defineProperty(error, 'cause', { value: cause, enumerable: false });
  return error;
}

export class TransportRegistry {
  private readonly entries = new Map<string, IRegistryEntry>();
  private readonly settingsPath: string;
  private generation: IRunGeneration | undefined;

  constructor(settingsPath: string) {
    this.settingsPath = settingsPath;
  }

  register(transport: ITransportAdapter<IInteractiveSession>): void {
    if (this.entries.has(transport.name)) {
      throw new Error(`Duplicate transport name: ${transport.name}`);
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

  getEnabled(): ITransportAdapter<IInteractiveSession>[] {
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
    const generation = this.createGeneration();
    this.generation = generation;

    for (const transport of this.getEnabled()) {
      transport.attach(session);
      await transport.start();
      if (isRunnerTransport(transport)) {
        this.trackRunner(generation, transport);
      }
    }

    generation.sealed = true;
    if (generation.pending === 0) {
      this.settleCompletion(generation);
      this.settleFailure(generation, undefined);
    }
  }

  waitForCompletion(): Promise<ITransportCompletionRecord[]> {
    return this.generation?.completion.promise ?? Promise.resolve([]);
  }

  waitForFailure(): Promise<ITransportCompletionRecord | undefined> {
    return this.generation?.failure.promise ?? Promise.resolve(undefined);
  }

  async stopAll(): Promise<IDestroyResult> {
    const errors: Error[] = [];
    const generation = this.generation;
    if (generation) {
      generation.active = false;
      this.settleCompletion(generation);
      this.settleFailure(generation, undefined);
      this.generation = undefined;
    }

    for (const { transport } of this.entries.values()) {
      try {
        await transport.stop();
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    return { errors };
  }

  private createGeneration(): IRunGeneration {
    const completion = deferred<ITransportCompletionRecord[]>();
    const failure = deferred<ITransportCompletionRecord | undefined>();
    // Both rejections are owned immediately; later callers still receive the original rejection.
    void completion.promise.catch(() => undefined);
    void failure.promise.catch(() => undefined);
    return {
      active: true,
      sealed: false,
      pending: 0,
      settled: false,
      failureSettled: false,
      orderedNames: [],
      records: new Map(),
      completion,
      failure,
    };
  }

  private trackRunner(
    generation: IRunGeneration,
    runner: ITransportRunnerAdapter<IInteractiveSession>,
  ): void {
    generation.pending += 1;
    generation.orderedNames.push(runner.name);
    void runner.waitForCompletion().then(
      (outcome) => {
        if (!generation.active) return;
        const record = { name: runner.name, outcome } satisfies ITransportCompletionRecord;
        generation.records.set(runner.name, record);
        generation.pending -= 1;
        if (outcome.status === 'failed') this.settleFailure(generation, record);
        if (generation.sealed && generation.pending === 0) {
          this.settleCompletion(generation);
          this.settleFailure(generation, undefined);
        }
      },
      (cause: unknown) => {
        if (!generation.active) return;
        const error = lifecycleError(runner.name, cause);
        generation.active = false;
        generation.completion.reject(error);
        generation.failure.reject(error);
        generation.settled = true;
        generation.failureSettled = true;
      },
    );
  }

  private settleCompletion(generation: IRunGeneration): void {
    if (generation.settled) return;
    generation.settled = true;
    generation.completion.resolve(
      generation.orderedNames.flatMap((name) => {
        const record = generation.records.get(name);
        return record ? [record] : [];
      }),
    );
  }

  private settleFailure(
    generation: IRunGeneration,
    record: ITransportCompletionRecord | undefined,
  ): void {
    if (generation.failureSettled) return;
    generation.failureSettled = true;
    generation.failure.resolve(record);
  }

  private requireConfigurable(name: string): IConfigurableTransport<IInteractiveSession> {
    const entry = this.entries.get(name);
    if (!entry) throw configurationError(name, 'unknown-transport');
    if (!entry.configurable) throw configurationError(name, 'not-configurable');
    return entry.configurable;
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

/**
 * TransportRegistry — manages IConfigurableTransport instances with settings-backed enable/disable.
 *
 * Settings file shape (under `transports` key in settings.json):
 *   { "ws": { "enabled": true, "options": { "port": 7070 } } }
 */

import { readSettings, writeSettings, type TSettingsData } from '@robota-sdk/agent-framework';

import type { IDestroyResult, TUniversalValue } from '@robota-sdk/agent-core';
import type {
  IConfigurableTransport,
  IInteractiveSession,
  ITransportConfig,
  ITransportEntry,
} from '@robota-sdk/agent-interface-transport';

export class TransportRegistry {
  private readonly entries = new Map<string, IConfigurableTransport<IInteractiveSession>>();
  private readonly settingsPath: string;
  /** ARCH-011: in-flight `start()` promises of run-to-completion transports, by name. */
  private readonly running = new Map<string, Promise<void>>();
  /** Failures of run-to-completion transports, held until `waitForCompletion` asks for them. */
  private readonly failures: unknown[] = [];

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

  /**
   * Start every enabled transport. ARCH-011.
   *
   * A transport that declares `runsToCompletion` is started WITHOUT being awaited — its `start()`
   * does not return while it is alive, and awaiting it meant every transport behind it never
   * started. Its promise is kept, not dropped: `waitForCompletion()` is where its result and its
   * failure arrive, because a transport whose entire job happens inside `start()` is exactly the one
   * whose failure matters, and an unawaited rejection would be an unhandled promise instead of a
   * reported error.
   */
  async startAll(session: IInteractiveSession): Promise<void> {
    const enabled = this.getEnabled();
    for (const transport of enabled) {
      transport.attach(session);
      if (transport.runsToCompletion === true) {
        this.trackRunToCompletion(transport.name, transport.start());
        continue;
      }
      await transport.start();
    }
  }

  /**
   * Take ownership of a run-to-completion transport's promise.
   *
   * The handler is attached HERE, not left to `waitForCompletion`. Merely storing the promise does
   * not attach one: a rejection between `startAll` returning and the caller getting round to
   * `waitForCompletion` is an unhandled rejection, which on Node ≥15 aborts the process — measured,
   * exit code 1, bypassing shutdown entirely. The first draft's comment claimed the opposite. The
   * outcome is recorded and replayed instead, so the failure arrives when it is asked for and never
   * escapes in the meantime.
   *
   * The entry is dropped once it settles, so a registry that is stopped and started again — a session
   * switch does exactly this — does not accumulate or overwrite them.
   */
  private trackRunToCompletion(name: string, promise: Promise<void>): void {
    const tracked = promise.then(
      () => {
        this.running.delete(name);
      },
      (error: unknown) => {
        this.running.delete(name);
        this.failures.push(error);
      },
    );
    this.running.set(name, tracked);
  }

  /**
   * Settle when every run-to-completion transport has finished, rejecting with the first failure to
   * occur. Resolves immediately when there are none, which is the ordinary case.
   */
  async waitForCompletion(): Promise<void> {
    await Promise.all([...this.running.values()]);
    const first = this.failures.shift();
    if (first !== undefined) {
      throw first;
    }
  }

  /**
   * Stop every registered transport — **best-effort** (CORE-013 disposal convention): one
   * transport's stop failure must not skip the others or reject a fire-and-forget caller.
   * Failures are collected into the returned result.
   */
  async stopAll(): Promise<IDestroyResult> {
    const errors: Error[] = [];
    // ARCH-011: a run-to-completion transport is ABANDONED here, not awaited. `stopAll`'s contract is
    // best-effort and bounded (CORE-013); waiting on a transport whose `stop()` is a documented no-op
    // — which both of them are — would make it neither. Dropping the tracking is what makes it
    // honest: `waitForCompletion` after a stop resolves rather than hanging on work nobody will
    // finish, and a later `startAll` (a session switch does this) starts from empty.
    this.running.clear();
    this.failures.length = 0;
    for (const transport of this.entries.values()) {
      try {
        await transport.stop();
      } catch (error) {
        // allow-fallback: best-effort disposal IS the contract — the failure is collected into the returned result and the remaining transports still stop (CORE-013 convention)
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    return { errors };
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

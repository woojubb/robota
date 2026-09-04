/**
 * Configurable transport contracts — enable/disable + options schema.
 */

import type {
  ITransportCompletionRecord,
  ITransportFailureRecord,
  ITransportServiceAdapter,
  TTransportAdapter,
} from './transport-adapter.js';
import type { IDestroyResult } from '@robota-sdk/agent-core';

export interface ITransportConfig {
  enabled: boolean;
  options?: Record<string, unknown>;
}

export interface ITransportSettingsCapability {
  readonly defaultEnabled: boolean;
  readonly optionsSchema?: Record<string, { type: string; description: string; default?: unknown }>;
  validateOptions?(options: Record<string, unknown>): boolean;
  /**
   * TRANS-002 (issue #2480): receive the persisted `options` before `attach`/`start`. The registry
   * calls this at `startAll` with the resolved options (after `validateOptions`); a transport that
   * declares an `optionsSchema` and omits this method is refused when non-empty options are saved,
   * because silently ignoring a saved option is the one wrong state.
   */
  configure?(options: Record<string, unknown>): void;
}

/** What is persisted for one transport (TRANS-010, issue #2480). */
export interface ITransportSavedConfig {
  enabled?: boolean;
  options?: Record<string, unknown>;
}

/**
 * TRANS-010 (issue #2480): the storage port the registry's settings view reads and writes through, so
 * the transport package owns no settings file, path or format — the shell composes one.
 */
export interface ITransportSettingsRepository {
  readAll(): Record<string, ITransportSavedConfig>;
  write(name: string, saved: ITransportSavedConfig): void;
}

/** Legacy configurable transports are services; settings remain an orthogonal capability. */
export interface IConfigurableTransport<TSession = unknown>
  extends ITransportServiceAdapter<TSession>, ITransportSettingsCapability {}

export type TConfigurableTransport<TSession = unknown> = TTransportAdapter<TSession> &
  ITransportSettingsCapability;

export interface ITransportEntry<TSession = unknown> {
  transport: TConfigurableTransport<TSession>;
  config: ITransportConfig;
}

export type TTransportConfigurationErrorCode =
  'unknown-transport' | 'not-configurable' | 'invalid-options' | 'options-not-applicable';

export interface ITransportConfigurationError extends Error {
  readonly name: 'TransportConfigurationError';
  readonly code: TTransportConfigurationErrorCode;
  readonly transportName: string;
}

export interface ITransportLifecycleRegistryView<TSession = unknown> {
  register(transport: TTransportAdapter<TSession>): void;
  startAll(session: TSession): Promise<void>;
  waitForCompletion(): Promise<ITransportCompletionRecord[]>;
  waitForFailure(): Promise<ITransportFailureRecord | undefined>;
  /** Best-effort: never rejects; per-transport stop failures come back in the result (CORE-013). */
  stopAll(): Promise<IDestroyResult>;
}

export interface ITransportSettingsRegistryView<TSession = unknown> {
  getAll(): ITransportEntry<TSession>[];
  setEnabled(name: string, enabled: boolean): Promise<void>;
  setOptions(name: string, options: Record<string, unknown>): Promise<void>;
}

export interface ITransportRegistryView<TSession = unknown>
  extends ITransportLifecycleRegistryView<TSession>, ITransportSettingsRegistryView<TSession> {}

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

export type TTransportConfigurationErrorCode = 'unknown-transport' | 'not-configurable';

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

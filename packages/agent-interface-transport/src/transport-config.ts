/**
 * Configurable transport contracts — enable/disable + options schema.
 */

import type { ITransportAdapter } from './transport-adapter.js';
import type { IDestroyResult } from '@robota-sdk/agent-core';

export interface ITransportConfig {
  enabled: boolean;
  options?: Record<string, unknown>;
}

export interface IConfigurableTransport<TSession = unknown> extends ITransportAdapter<TSession> {
  readonly defaultEnabled: boolean;
  readonly optionsSchema?: Record<string, { type: string; description: string; default?: unknown }>;
  validateOptions?(options: Record<string, unknown>): boolean;
}

export interface ITransportEntry<TSession = unknown> {
  transport: IConfigurableTransport<TSession>;
  config: ITransportConfig;
}

export interface ITransportRegistryView<TSession = unknown> {
  getAll(): ITransportEntry<TSession>[];
  setEnabled(name: string, enabled: boolean): Promise<void>;
  startAll(session: TSession): Promise<void>;
  /** Best-effort: never rejects; per-transport stop failures come back in the result (CORE-013). */
  stopAll(): Promise<IDestroyResult>;
}

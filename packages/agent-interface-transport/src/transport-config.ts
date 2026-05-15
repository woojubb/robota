/**
 * Configurable transport contracts — enable/disable + options schema.
 */

import type { TUniversalValue } from '@robota-sdk/agent-core';
import type { ITransportAdapter } from './transport-adapter.js';

export interface ITransportConfig {
  enabled: boolean;
  options?: Record<string, TUniversalValue>;
}

export interface IConfigurableTransport<TSession = import('@robota-sdk/agent-core').ISession>
  extends ITransportAdapter<TSession> {
  readonly defaultEnabled: boolean;
  readonly optionsSchema?: Record<
    string,
    { type: string; description: string; default?: TUniversalValue }
  >;
  validateOptions?(options: Record<string, TUniversalValue>): boolean;
}

export interface ITransportEntry<TSession = import('@robota-sdk/agent-core').ISession> {
  transport: IConfigurableTransport<TSession>;
  config: ITransportConfig;
}

export interface ITransportRegistryView<TSession = import('@robota-sdk/agent-core').ISession> {
  getAll(): ITransportEntry<TSession>[];
  setEnabled(name: string, enabled: boolean): Promise<void>;
  startAll(session: TSession): Promise<void>;
  stopAll(): Promise<void>;
}
